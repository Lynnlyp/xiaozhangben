/* 小账本 V0.1 - IndexedDB 数据层 */

const DB_NAME = 'xiaozhangben';
const DB_VERSION = 1;
const STORE_NAME = 'records';

let _db = null;

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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        var store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
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

// 添加一条记录
function addRecord(record) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readwrite');
      var store = tx.objectStore(STORE_NAME);

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
      var tx = db.transaction(STORE_NAME, 'readonly');
      var store = tx.objectStore(STORE_NAME);
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

// 计算本月收入、支出、结余
function getMonthSummary() {
  return getMonthRecords().then(function(records) {
    var income = 0;
    var expense = 0;
    records.forEach(function(r) {
      if (r.type === 'income') {
        income += Number(r.amount) || 0;
      } else {
        expense += Number(r.amount) || 0;
      }
    });
    return {
      income: income,
      expense: expense,
      balance: income - expense
    };
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
      var tx = db.transaction(STORE_NAME, 'readwrite');
      var store = tx.objectStore(STORE_NAME);
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
      var tx = db.transaction(STORE_NAME, 'readwrite');
      var store = tx.objectStore(STORE_NAME);
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
    months.reverse(); // 最新的月份在前
    return months;
  });
}

// 导出所有数据（用于备份）
function exportAllData() {
  return getAllRecords().then(function(records) {
    var exportObj = {
      app: '小账本',
      version: '0.1',
      exportTime: new Date().toISOString(),
      recordCount: records.length,
      records: records
    };
    return JSON.stringify(exportObj, null, 2);
  });
}

// 批量导入记录（覆盖式导入，先清空再导入）
function importRecords(jsonStr) {
  var data;
  try {
    data = JSON.parse(jsonStr);
  } catch(e) {
    return Promise.reject('JSON 格式错误');
  }

  var records = data.records || data;
  if (!Array.isArray(records)) {
    return Promise.reject('数据格式错误：找不到记录数组');
  }

  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readwrite');
      var store = tx.objectStore(STORE_NAME);

      // 先清空所有旧数据
      var clearRequest = store.clear();
      clearRequest.onsuccess = function() {
        // 导入新数据
        var imported = 0;
        records.forEach(function(r) {
          // 确保每个记录有 createdAt
          if (!r.createdAt) {
            r.createdAt = Date.now();
          }
          store.add(r);
          imported++;
        });

        tx.oncomplete = function() {
          resolve(imported);
        };
        tx.onerror = function(event) {
          reject('导入失败: ' + event.target.error.message);
        };
      };
      clearRequest.onerror = function(event) {
        reject('清空旧数据失败: ' + event.target.error.message);
      };
    });
  });
}