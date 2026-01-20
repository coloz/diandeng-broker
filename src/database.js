const Database = require('better-sqlite3');
const path = require('path');

let db = null;

/**
 * 初始化数据库
 */
function initDatabase() {
  const dbPath = path.join(__dirname, '..', 'data', 'broker.db');
  
  // 确保data目录存在
  const fs = require('fs');
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(dbPath);
  
  // 启用WAL模式提升性能
  db.pragma('journal_mode = WAL');

  // 创建设备表
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      token TEXT NOT NULL,
      auth_key TEXT UNIQUE NOT NULL,
      client_id TEXT,
      username TEXT,
      password TEXT,
      iot_token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 创建设备组表
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 创建设备-组关联表
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id),
      FOREIGN KEY (group_id) REFERENCES groups(id),
      UNIQUE(device_id, group_id)
    )
  `);

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_devices_auth_key ON devices(auth_key);
    CREATE INDEX IF NOT EXISTS idx_devices_uuid ON devices(uuid);
    CREATE INDEX IF NOT EXISTS idx_devices_client_id ON devices(client_id);
    CREATE INDEX IF NOT EXISTS idx_device_groups_device_id ON device_groups(device_id);
    CREATE INDEX IF NOT EXISTS idx_device_groups_group_id ON device_groups(group_id);
  `);

  console.log('数据库表结构初始化完成');
  return db;
}

/**
 * 获取数据库实例
 */
function getDb() {
  if (!db) {
    throw new Error('数据库未初始化');
  }
  return db;
}

/**
 * 创建设备
 */
function createDevice(uuid, token, authKey) {
  const stmt = getDb().prepare(`
    INSERT INTO devices (uuid, token, auth_key)
    VALUES (?, ?, ?)
  `);
  return stmt.run(uuid, token, authKey);
}

/**
 * 通过authKey获取设备
 */
function getDeviceByAuthKey(authKey) {
  const stmt = getDb().prepare(`
    SELECT * FROM devices WHERE auth_key = ?
  `);
  return stmt.get(authKey);
}

/**
 * 通过uuid获取设备
 */
function getDeviceByUuid(uuid) {
  const stmt = getDb().prepare(`
    SELECT * FROM devices WHERE uuid = ?
  `);
  return stmt.get(uuid);
}

/**
 * 通过clientId获取设备
 */
function getDeviceByClientId(clientId) {
  const stmt = getDb().prepare(`
    SELECT * FROM devices WHERE client_id = ?
  `);
  return stmt.get(clientId);
}

/**
 * 更新设备连接信息
 */
function updateDeviceConnection(authKey, clientId, username, password, iotToken) {
  const stmt = getDb().prepare(`
    UPDATE devices 
    SET client_id = ?, username = ?, password = ?, iot_token = ?, updated_at = CURRENT_TIMESTAMP
    WHERE auth_key = ?
  `);
  return stmt.run(clientId, username, password, iotToken, authKey);
}

/**
 * 创建组
 */
function createGroup(name) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO groups (name) VALUES (?)
  `);
  return stmt.run(name);
}

/**
 * 获取组
 */
function getGroupByName(name) {
  const stmt = getDb().prepare(`
    SELECT * FROM groups WHERE name = ?
  `);
  return stmt.get(name);
}

/**
 * 将设备添加到组
 */
function addDeviceToGroup(deviceId, groupId) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO device_groups (device_id, group_id) VALUES (?, ?)
  `);
  return stmt.run(deviceId, groupId);
}

/**
 * 获取设备所在的所有组
 */
function getDeviceGroups(deviceId) {
  const stmt = getDb().prepare(`
    SELECT g.* FROM groups g
    INNER JOIN device_groups dg ON g.id = dg.group_id
    WHERE dg.device_id = ?
  `);
  return stmt.all(deviceId);
}

/**
 * 获取组内所有设备
 */
function getGroupDevices(groupId) {
  const stmt = getDb().prepare(`
    SELECT d.* FROM devices d
    INNER JOIN device_groups dg ON d.id = dg.device_id
    WHERE dg.group_id = ?
  `);
  return stmt.all(groupId);
}

/**
 * 检查设备是否在指定组中
 */
function isDeviceInGroup(deviceId, groupName) {
  const stmt = getDb().prepare(`
    SELECT 1 FROM device_groups dg
    INNER JOIN groups g ON g.id = dg.group_id
    WHERE dg.device_id = ? AND g.name = ?
  `);
  return stmt.get(deviceId, groupName) !== undefined;
}

module.exports = {
  initDatabase,
  getDb,
  createDevice,
  getDeviceByAuthKey,
  getDeviceByUuid,
  getDeviceByClientId,
  updateDeviceConnection,
  createGroup,
  getGroupByName,
  addDeviceToGroup,
  getDeviceGroups,
  getGroupDevices,
  isDeviceInGroup
};
