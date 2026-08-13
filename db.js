/* 小账本 V0.5 - IndexedDB 数据层 */

const DB_NAME = 'xiaozhangben';
const DB_VERSION = 3;
const STORE_RECORDS = 'records';
const STORE_DEBTS = 'debts';
const STORE_REPAYMENTS = 'repayments';

let _db = null;

// 新 8 分类映射（内部 ID → 显示名）
var NEW_CATEGORIES = {
  'necessities_food': '温饱',
  'treat_food':      '贪吃',
  'shopping':        '买买',
  'transport':       '出行',
  'learning':        '学习',
  'household':       '家用',
  'health':          '健康',
  'fun':             '玩乐'
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
  // V0.4 旧 responsibility 数据 → 显示「责任（历史）」
  if (category === 'responsibility') return '责任（历史）';
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

// 迁移旧 responsibility 数据到 repayments（首次打开 V0.5 时执行一次）
function migrateOldResponsibility() {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction([STORE_RECORDS, STORE_REPAYMENTS], 'readwrite');
      var recordStore = tx.objectStore(STORE_RECORDS);
      var repayStore = tx.objectStore(STORE_REPAYMENTS);
      var cursorReq = recordStore.openCursor();

      var migrated = 0;
      cursorReq.onsuccess = function(e) {
        var cursor = e.target.result;
        if (cursor) {
          var r = cursor.value;
          if (r.category === 'responsibility') {
            var repayment = {
              debtId: null,
              amount: Number(r.amount) || 0,
              date: r.date || '',
              note: r.note || '',
              owner: r.owner || null,
              status: 'confirmed',
              migratedFrom: r.id,
              createdAt: r.createdAt || Date.now(),
              updatedAt: r.createdAt || Date.now()
            };
            repayStore.add(repayment);
            migrated++;
          }
          cursor.continue();
        } else {
          console.log('迁移完成: ' + migrated + ' 条');
          resolve(migrated);
        }
      };
      cursorReq.onerror = function() {
        reject('迁移失败');
      };
    });
  });
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

      // V0.1: 创建 records store
      if (oldVersion < 1) {
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
      }

      // V0.2: 新增 debts store
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

      // V0.5: 新增 repayments store（迁移在首次打开时独立执行）
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains(STORE_REPAYMENTS)) {
          var repayStore = db.createObjectStore(STORE_REPAYMENTS, {
            keyPath: 'id',
            autoIncrement: true
          });
          repayStore.createIndex('debtId', 'debtId', { unique: false });
          repayStore.createIndex('date', 'date', { unique: false });
          repayStore.createIndex('createdAt', 'createdAt', { unique: false });
          repayStore.createIndex('status', 'status', { unique: false });
        }
      }
    };

    request.onsuccess = function(event) {
      _db = event.target.result;
      resolve(_db);

      // 使用 localStorage 标记避免重复迁移（仅首次打开 V0.5 时执行）
      var migrationKey = 'xiaozhangben_migrated_v3';
      if (!localStorage.getItem(migrationKey)) {
        migrateOldResponsibility().then(function() {
          localStorage.setItem(migrationKey, '1');
        }).catch(function() {});
      }
    };

    request.onerror = function(event) {
      reject('数据库打开失败: ' + event.target.error.message);
    };
  });
}

// ==================== records 操作 ====================

// 添加一条记录（消费）
function addRecord(record) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(STORE_RECORDS, 'readwrite');
      var store = tx.objectStore(STORE_RECORDS);

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

// 获取所有有数据的月份列表
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

// ==================== 责任（debts）操作 ====================

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
        reject('查询失败: ' + event.target.error.message);
      };
    });
  });
}

function getActiveDebts() {
  return getAllDebts().then(function(debts) {
    return debts.filter(function(d) {
      return !d.status || d.status === 'active';
    });
  });
}

function getDebtSummary() {
  return getAllDebts().then(function(debts) {
    var totalRemaining = 0;
    var monthlyDue = 0;
    var activeDebts = [];
    debts.forEach(function(d) {
      if (d.status === 'active' || !d.status) {
        totalRemaining += Number(d.remainingAmount) || 0;
        monthlyDue += Number(d.installmentAmount) || 0;
        activeDebts.push(d);
      }
    });
    return {
      totalRemaining: totalRemaining,
      monthlyDue: monthlyDue,
      activeDebts: activeDebts,
      settledCount: debts.length - activeDebts.length
    };
  });
}

function addDebt(debt) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(STORE_DEBTS, 'readwrite');
      var store = tx.objectStore(STORE_DEBTS);

      debt.status = debt.status || 'active';
      debt.createdAt = Date.now();
      debt.updatedAt = Date.now();

      var request = store.add(debt);

      request.onsuccess = function(event) {
        resolve(event.target.result);
      };
      request.onerror = function(event) {
        reject('添加失败: ' + event.target.error.message);
      };
    });
  });
}

function updateDebt(debt) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(STORE_DEBTS, 'readwrite');
      var store = tx.objectStore(STORE_DEBTS);

      debt.updatedAt = Date.now();

      var request = store.put(debt);

      request.onsuccess = function() {
        resolve(true);
      };
      request.onerror = function(event) {
        reject('更新失败: ' + event.target.error.message);
      };
    });
  });
}

function deleteDebt(id) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(STORE_DEBTS, 'readwrite');
      var store = tx.objectStore(STORE_DEBTS);
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

function settleDebt(id) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(STORE_DEBTS, 'readwrite');
      var store = tx.objectStore(STORE_DEBTS);
      var getRequest = store.get(id);

      getRequest.onsuccess = function() {
        var debt = getRequest.result;
        if (!debt) { reject('未找到'); return; }
        debt.status = 'settled';
        debt.remainingAmount = 0;
        debt.remainingPeriods = 0;
        debt.updatedAt = Date.now();
        var putRequest = store.put(debt);
        putRequest.onsuccess = function() { resolve(true); };
        putRequest.onerror = function(e) { reject('更新失败'); };
      };
      getRequest.onerror = function(e) { reject('查询失败'); };
    });
  });
}

// ==================== 还款（repayments）操作 ====================

function addRepayment(repayment) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction([STORE_REPAYMENTS, STORE_DEBTS], 'readwrite');

      // 写入 repayment
      repayment.status = repayment.status || 'confirmed';
      repayment.createdAt = Date.now();
      repayment.updatedAt = Date.now();

      var repayStore = tx.objectStore(STORE_REPAYMENTS);
      var addRequest = repayStore.add(repayment);

      addRequest.onsuccess = function() {
        // 添加成功后重新计算 debt.remainingAmount
        recalcDebtRemaining(tx, repayment.debtId).then(function() {
          resolve(addRequest.result);
        }).catch(function(err) {
          reject(err);
        });
      };

      addRequest.onerror = function(event) {
        reject('添加还款失败: ' + event.target.error.message);
      };
    });
  });
}

function getRepaymentsByDebtId(debtId) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(STORE_REPAYMENTS, 'readonly');
      var store = tx.objectStore(STORE_REPAYMENTS);
      var index = store.index('debtId');
      var request = index.openCursor(IDBKeyRange.only(debtId));

      var repayments = [];
      request.onsuccess = function(event) {
        var cursor = event.target.result;
        if (cursor) {
          repayments.push(cursor.value);
          cursor.continue();
        } else {
          // 按时间倒序
          repayments.sort(function(a, b) {
            return (b.createdAt || 0) - (a.createdAt || 0);
          });
          resolve(repayments);
        }
      };
      request.onerror = function(event) {
        reject('查询失败: ' + event.target.error.message);
      };
    });
  });
}

function getMonthRepaymentTotal() {
  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, '0');
  var monthPrefix = y + '-' + m;

  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(STORE_REPAYMENTS, 'readonly');
      var store = tx.objectStore(STORE_REPAYMENTS);
      var request = store.getAll();

      request.onsuccess = function(event) {
        var all = event.target.result || [];
        var total = 0;
        all.forEach(function(r) {
          if (r.status === 'confirmed' && r.date && r.date.startsWith(monthPrefix)) {
            total += Number(r.amount) || 0;
          }
        });
        resolve(total);
      };
      request.onerror = function(event) {
        reject('查询失败: ' + event.target.error.message);
      };
    });
  });
}

function deleteRepayment(id) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction([STORE_REPAYMENTS, STORE_DEBTS], 'readwrite');

      // 先获取 repayment 得到 debtId
      var repayStore = tx.objectStore(STORE_REPAYMENTS);
      var getRequest = repayStore.get(id);

      getRequest.onsuccess = function() {
        var repayment = getRequest.result;
        if (!repayment) { reject('未找到'); return; }

        var debtId = repayment.debtId;
        var deleteRequest = repayStore.delete(id);

        deleteRequest.onsuccess = function() {
          if (debtId) {
            recalcDebtRemaining(tx, debtId).then(function() {
              resolve(true);
            }).catch(function(err) {
              reject(err);
            });
          } else {
            resolve(true);
          }
        };
        deleteRequest.onerror = function(e) {
          reject('删除失败');
        };
      };
      getRequest.onerror = function(e) {
        reject('查询失败');
      };
    });
  });
}

// 重新计算 debt.remainingAmount
function recalcDebtRemaining(tx, debtId) {
  return new Promise(function(resolve, reject) {
    if (!debtId) { resolve(); return; }

    var repayStore = tx.objectStore(STORE_REPAYMENTS);
    var debtStore = tx.objectStore(STORE_DEBTS);

    // 获取关联 debt
    var debtGet = debtStore.get(debtId);
    debtGet.onsuccess = function() {
      var debt = debtGet.result;
      if (!debt) { resolve(); return; }

      // 计算所有有效 repayments 总和
      var index = repayStore.index('debtId');
      var cursorReq = index.openCursor(IDBKeyRange.only(debtId));

      var totalPaid = 0;
      cursorReq.onsuccess = function(e) {
        var cursor = e.target.result;
        if (cursor) {
          if (cursor.value.status === 'confirmed') {
            totalPaid += Number(cursor.value.amount) || 0;
          }
          cursor.continue();
        } else {
          // 计算新的剩余金额
          var newRemaining = Math.max(0, (Number(debt.originalAmount) || 0) - totalPaid);
          debt.remainingAmount = newRemaining;
          debt.remainingPeriods = Math.ceil(newRemaining / (Number(debt.installmentAmount) || 1));
          if (newRemaining <= 0) {
            debt.status = 'settled';
          }
          debt.updatedAt = Date.now();
          debtStore.put(debt);
          resolve();
        }
      };
      cursorReq.onerror = function() { reject('计算失败'); };
    };
    debtGet.onerror = function() { reject('查询债务失败'); };
  });
}

// ==================== 导出/导入 ====================

function exportAllData() {
  var records, debts, repayments;
  return getAllRecords().then(function(r) {
    records = r;
    return getAllDebts();
  }).then(function(d) {
    debts = d;
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_REPAYMENTS, 'readonly');
        var store = tx.objectStore(STORE_REPAYMENTS);
        var req = store.getAll();
        req.onsuccess = function() { resolve(req.result || []); };
        req.onerror = function(e) { reject('查询失败'); };
      });
    });
  }).then(function(r) {
    repayments = r;
    var exportObj = {
      app: '小账本',
      version: '0.5',
      exportTime: new Date().toISOString(),
      recordCount: records.length,
      debtCount: debts.length,
      repaymentCount: repayments.length,
      records: records,
      debts: debts,
      repayments: repayments
    };
    return JSON.stringify(exportObj, null, 2);
  });
}

// ==================== 首页统计 ====================

function getHomeData() {
  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, '0');
  var monthPrefix = y + '-' + m;

  return getAllRecords().then(function(records) {
    var monthRecords = records.filter(function(r) {
      return r.date && r.date.startsWith(monthPrefix);
    });

    // 本月消费（仅8个消费分类，不含 responsibility）
    var totalConsumption = 0;
    var ownerStats = { 'self': 0, 'family': 0, 'son': 0, 'studio': 0, 'unclassified': 0 };
    var recent = records.slice(0, 10);

    monthRecords.forEach(function(r) {
      if (r.type === 'expense') {
        var amt = Number(r.amount) || 0;
        // 跳过旧 responsibility 数据（已迁移到 repayments）
        if (r.category === 'responsibility') return;
        totalConsumption += amt;
        if (r.owner && ownerStats[r.owner] !== undefined) {
          ownerStats[r.owner] += amt;
        } else {
          ownerStats.unclassified += amt;
        }
      }
    });

    return {
      totalConsumption: totalConsumption,
      ownerStats: ownerStats,
      recentRecords: recent
    };
  }).then(function(homeData) {
    return getDebtSummary().then(function(debtSummary) {
      homeData.debtSummary = debtSummary;
      return homeData;
    });
  });
}