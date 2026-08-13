/* 小账本 V0.2 - IndexedDB 数据层 */

const DB_NAME = 'xiaozhangben';
const DB_VERSION = 2;
const STORE_RECORDS = 'records';
const STORE_DEBTS = 'debts';

let _db = null;

// 新 9 分类映射（内部 ID → 显示名）
var NEW_CATEGORIES = {
  'necessities_food': '温饱',
  'treat_food':      '贪吃',
  'shopping':        '买买',
  'transport':       '出行',
  'learning':        '学习',
  'household':       '家用',
  'health':          '健康',
  'fun':             '玩乐',
  'responsibility':  '责任'
};

// 消费分类列表（用于统计「本月花了」）
var CONSUMPTION_CATEGORIES = {
  'necessities_food': true,
  'treat_food': true,
  'shopping': true,
  'transport': true,
  'learning': true,
  'household': true,
  'health': true,
  'fun': true
};

// 旧分类 → 新分类（明确映射的）
var LEGACY_MAPPING = {
  '交通': '出行',
  '购物': '买买',
  '医疗': '健康',
  '教育': '学习',
  '娱乐': '玩乐'
};

// 归属显示名
var OWNER_NAMES = {
  'self': '自己',
  'family': '家里',
  'son': '儿子',
  'studio': '工作室'
};

// 获取分类显示名（兼容新旧）
function getCategoryDisplay(category) {
  // V0.2 新英文 ID
  if (NEW_CATEGORIES[category]) return NEW_CATEGORIES[category];
  // V0.1 旧中文分类 → 明确映射
  if (LEGACY_MAPPING[category]) return LEGACY_MAPPING[category];
  // V0.1 旧中文分类 → 不确定的，保留 legacy 标记
  if (category) return '旧·' + category;
  return '未分类';
}

// 获取归属显示名
function getOwnerDisplay(owner) {
  if (owner && OWNER_NAMES[owner]) return OWNER_NAMES[owner];
  return '未归类';
}

// 打开数据库
function openDB() {
  return new Promise(function(resolve, reject) {
    if (_db) {
      resolve(_db);
      return;
    }

    var request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = function(event) {
      var db = event.target.result;
      var oldVersion = event.oldVersion;

      // V0.1 升级到 V0.2：新增 debts store
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(STORE_DEBTS)) {
          var debtStore = db.createObjectStore(STORE_DEBTS, {
            keyPath: 'id',
            autoIncrement: true
          });
          debtStore.createIndex('status', 'status', { unique: false });
          debtStore.createIndex('owner', 'owner', { unique: false });
          debtStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      }

      // 如果 records store 还不存在（全新安装）
      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        var store = db.createObjectStore(STORE_RECORDS, {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('owner', 'owner', { unique: false });
      }
    };

    request.onsuccess = function(event) {
      _db = event.target.result;
      resolve(_db);
    };

    request.onerror = function(event) {
      reject('数据库打开失败: ' + event.target.error.message);
    };
  });
}

// 添加一条记录（V0.2 支持 owner / reviewTag）
function addRecord(record) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(STORE_RECORDS, 'readwrite');
      var store = tx.objectStore(STORE_RECORDS);

      // 补充时间戳
      record.createdAt = Date.now();

      var request = store.add(record);

      request.onsuccess = function(event) {
        resolve(event.target.result);
      };

      request.onerror = function(event) {
        reject('添加失败: ' + event.target.error.message);
      };
    });
  });
}

// 获取所有记录（按时间倒序）
function getAllRecords() {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(STORE_RECORDS, 'readonly');
      var store = tx.objectStore(STORE_RECORDS);
      var index = store.index('createdAt');
      var request = index.openCursor(null, 'prev');

      var records = [];
      request.onsuccess = function(event) {
        var cursor = event.target.result;
        if (cursor) {
          records.push(cursor.value);
          cursor.continue();
        } else {
          resolve(records);
        }
      };

      request.onerror = function(event) {
        reject('查询失败: ' + event.target.error.message);
      };
    });
  });
}

// 获取本月记录
function getMonthRecords() {
  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, '0');
  var monthPrefix = y + '-' + m;

  return getAllRecords().then(function(records) {
    return records.filter(function(r) {
      return r.date && r.date.startsWith(monthPrefix);
    });
  });
}

// 计算本月支出（不含收入）
function getMonthExpense() {
  return getMonthRecords().then(function(records) {
    var expense = 0;
    records.forEach(function(r) {
      if (r.type === 'expense') {
        expense += Number(r.amount) || 0;
      }
    });
    return expense;
  });
}

// 按 owner 统计本月支出
function getMonthExpenseByOwner() {
  return getMonthRecords().then(function(records) {
    var stats = { 'self': 0, 'family': 0, 'son': 0, 'studio': 0, 'unclassified': 0 };
    records.forEach(function(r) {
      if (r.type === 'expense') {
        var amt = Number(r.amount) || 0;
        if (r.owner && stats[r.owner] !== undefined) {
          stats[r.owner] += amt;
        } else {
          stats.unclassified += amt;
        }
      }
    });
    return stats;
  });
}

// 按类型筛选记录
function getRecordsByType(type) {
  return getAllRecords().then(function(records) {
    if (type === 'all') return records;
    return records.filter(function(r) { return r.type === type; });
  });
}

// 获取最近 N 条记录
function getRecentRecords(limit) {
  return getAllRecords().then(function(records) {
    return records.slice(0, limit || 10);
  });
}

// 支出分类统计（本月）
function getCategoryStats() {
  return getMonthRecords().then(function(records) {
    var stats = {};
    records.forEach(function(r) {
      if (r.type === 'expense') {
        var cat = r.category || '其他';
        stats[cat] = (stats[cat] || 0) + Number(r.amount);
      }
    });
    return stats;
  });
}

// 删除记录
function deleteRecord(id) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(STORE_RECORDS, 'readwrite');
      var store = tx.objectStore(STORE_RECORDS);
      var request = store.delete(id);

      request.onsuccess = function() {
        resolve(true);
      };

      request.onerror = function(event) {
        reject('删除失败: ' + event.target.error.message);
      };
    });
  });
}

// 更新记录
function updateRecord(record) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(STORE_RECORDS, 'readwrite');
      var store = tx.objectStore(STORE_RECORDS);
      var request = store.put(record);

      request.onsuccess = function() {
        resolve(true);
      };

      request.onerror = function(event) {
        reject('更新失败: ' + event.target.error.message);
      };
    });
  });
}

// 获取指定月份的记录
function getMonthRecordsByMonth(month) {
  return getAllRecords().then(function(records) {
    return records.filter(function(r) {
      return r.date && r.date.startsWith(month);
    });
  });
}

// 获取指定月份的统计
function getMonthSummaryByMonth(month) {
  return getMonthRecordsByMonth(month).then(function(records) {
    var income = 0;
    var expense = 0;
    records.forEach(function(r) {
      if (r.type === 'income') {
        income += Number(r.amount) || 0;
      } else {
        expense += Number(r.amount) || 0;
      }
    });
    return { income: income, expense: expense, balance: income - expense };
  });
}

// 获取指定月份的支出分类统计
function getCategoryStatsByMonth(month) {
  return getMonthRecordsByMonth(month).then(function(records) {
    var stats = {};
    var totalExpense = 0;
    records.forEach(function(r) {
      if (r.type === 'expense') {
        var cat = r.category || '其他';
        stats[cat] = (stats[cat] || 0) + Number(r.amount);
        totalExpense += Number(r.amount);
      }
    });
    return { stats: stats, total: totalExpense };
  });
}

// 获取所有有数据的月份列表（按时间倒序）
function getAvailableMonths() {
  return getAllRecords().then(function(records) {
    var monthSet = {};
    records.forEach(function(r) {
      if (r.date && r.date.length >= 7) {
        var m = r.date.substring(0, 7);
        monthSet[m] = true;
      }
    });
    var months = Object.keys(monthSet).sort();
    months.reverse();
    return months;
  });
}

// ==================== 待还（debts）操作 ====================

// 获取所有待还
function getAllDebts() {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(STORE_DEBTS, 'readonly');
      var store = tx.objectStore(STORE_DEBTS);
      var index = store.index('createdAt');
      var request = index.openCursor(null, 'prev');

      var debts = [];
      request.onsuccess = function(event) {
        var cursor = event.target.result;
        if (cursor) {
          debts.push(cursor.value);
          cursor.continue();
        } else {
          resolve(debts);
        }
      };
      request.onerror = function(event) {
        reject('查询待还失败: ' + event.target.error.message);
      };
    });
  });
}

// 获取待还总额
function getDebtSummary() {
  return getAllDebts().then(function(debts) {
    var totalRemaining = 0;
    var monthlyDue = 0;
    debts.forEach(function(d) {
      if (d.status === 'active' || !d.status) {
        totalRemaining += Number(d.remainingAmount) || 0;
        monthlyDue += Number(d.installmentAmount) || 0;
      }
    });
    return { totalRemaining: totalRemaining, monthlyDue: monthlyDue };
  });
}

// ==================== 导出/导入 ====================

// 导出所有数据（V0.2 格式，包含 records + debts）
function exportAllData() {
  return getAllRecords().then(function(records) {
    return getAllDebts().then(function(debts) {
      var exportObj = {
        app: '小账本',
        version: '0.2',
        exportTime: new Date().toISOString(),
        recordCount: records.length,
        debtCount: debts.length,
        records: records,
        debts: debts
      };
      return JSON.stringify(exportObj, null, 2);
    });
  });
}

// 验证导入数据（不碰数据库）
function validateImportData(data) {
  // 判断版本
  var isV02 = (data.version === '0.2') || Object.prototype.hasOwnProperty.call(data, 'debts');
  var records = data.records || data;
  var debts = data.debts;

  // 验证 records 是数组
  if (!Array.isArray(records)) {
    return { valid: false, error: 'records 必须是数组' };
  }

  // 验证 debts 如果是数组则必须是数组
  if (debts !== undefined && !Array.isArray(debts)) {
    return { valid: false, error: 'debts 必须是数组' };
  }

  // 逐条验证 records
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (typeof r.amount !== 'number' || r.amount <= 0) {
      return { valid: false, error: '第 ' + (i+1) + ' 条流水金额无效' };
    }
    if (r.type !== 'expense' && r.type !== 'income') {
      return { valid: false, error: '第 ' + (i+1) + ' 条流水类型无效' };
    }
    if (r.date && typeof r.date !== 'string') {
      return { valid: false, error: '第 ' + (i+1) + ' 条流水日期格式无效' };
    }
    if (r.id !== undefined && typeof r.id !== 'number') {
      return { valid: false, error: '第 ' + (i+1) + ' 条流水 id 无效' };
    }
  }

  // 逐条验证 debts
  if (debts) {
    for (var j = 0; j < debts.length; j++) {
      var d = debts[j];
      if (!d.name || typeof d.name !== 'string') {
        return { valid: false, error: '第 ' + (j+1) + ' 条待还名称无效' };
      }
      if (typeof d.originalAmount !== 'number') {
        return { valid: false, error: '第 ' + (j+1) + ' 条待还金额无效' };
      }
    }
  }

  return { valid: true, records: records, debts: debts, isV02: isV02 };
}

// 批量导入记录（V0.2 安全导入）
function importRecords(jsonStr) {
  var data;
  try {
    data = JSON.parse(jsonStr);
  } catch(e) {
    return Promise.reject('JSON 格式错误');
  }

  // 完整校验（不碰数据库）
  var validationResult = validateImportData(data);
  if (!validationResult.valid) {
    return Promise.reject(validationResult.error);
  }

  var isV02 = validationResult.isV02;
  var records = validationResult.records;
  var debts = validationResult.debts;

  // 判断涉及哪些 store
  var storeNames = [STORE_RECORDS];
  if (isV02) {
    storeNames.push(STORE_DEBTS);
  }

  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(storeNames, 'readwrite');

      tx.onerror = function(event) {
        reject('导入失败，事务已回滚');
      };
      tx.onabort = function(event) {
        reject('导入中止，数据已回滚');
      };
      tx.oncomplete = function() {
        resolve('导入成功');
      };

      // 清空 + 写入 records
      var recordStore = tx.objectStore(STORE_RECORDS);
      recordStore.clear();
      records.forEach(function(r) {
        if (!r.createdAt) {
          r.createdAt = Date.now();
        }
        recordStore.add(r);
      });

      // V0.2 完整备份：清空 + 写入 debts
      if (isV02) {
        var debtStore = tx.objectStore(STORE_DEBTS);
        debtStore.clear();
        if (debts) {
          debts.forEach(function(d) {
            debtStore.add(d);
          });
        }
      }
    });
  });
}

// ==================== 首页统计 ====================

// 获取首页数据（本月消费 + 本月责任 + 待还总额 + 最近流水）
function getHomeData() {
  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, '0');
  var monthPrefix = y + '-' + m;

  return getAllRecords().then(function(records) {
    var monthRecords = records.filter(function(r) {
      return r.date && r.date.startsWith(monthPrefix);
    });

    // 本月消费（仅8个消费分类）
    var totalConsumption = 0;
    // 本月责任
    var totalResponsibility = 0;
    // 消费 owner 统计
    var ownerStats = { 'self': 0, 'family': 0, 'son': 0, 'studio': 0, 'unclassified': 0 };
    // 责任 owner 统计
    var respOwnerStats = { 'self': 0, 'family': 0, 'son': 0, 'studio': 0, 'unclassified': 0 };
    // 最近流水（所有月份）
    var recent = records.slice(0, 10);

    monthRecords.forEach(function(r) {
      if (r.type === 'expense') {
        var amt = Number(r.amount) || 0;
        var cat = r.category;

        if (cat === 'responsibility') {
          // 责任统计
          totalResponsibility += amt;
          if (r.owner && respOwnerStats[r.owner] !== undefined) {
            respOwnerStats[r.owner] += amt;
          } else {
            respOwnerStats.unclassified += amt;
          }
        } else {
          // 消费统计（含旧/未分类数据）
          totalConsumption += amt;
          if (r.owner && ownerStats[r.owner] !== undefined) {
            ownerStats[r.owner] += amt;
          } else {
            ownerStats.unclassified += amt;
          }
        }
      }
    });

    return {
      totalConsumption: totalConsumption,
      ownerStats: ownerStats,
      totalResponsibility: totalResponsibility,
      respOwnerStats: respOwnerStats,
      recentRecords: recent
    };
  }).then(function(homeData) {
    // 获取待还总额
    return getDebtSummary().then(function(debtSummary) {
      homeData.debtSummary = debtSummary;
      return homeData;
    });
  });
}