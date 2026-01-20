/**
 * 设备缓存管理
 * 使用Map进行内存缓存，提升访问性能
 */
const config = require('./config');

class DeviceCache {
  constructor() {
    // 设备信息缓存 clientId -> deviceInfo
    this.deviceByClientId = new Map();
    
    // 设备信息缓存 authKey -> deviceInfo
    this.deviceByAuthKey = new Map();
    
    // 设备最后发布时间 clientId -> timestamp
    this.lastPublishTime = new Map();
    
    // 在线设备 clientId -> client
    this.onlineClients = new Map();
    
    // 设备组缓存 clientId -> groupNames[]
    this.deviceGroups = new Map();

    // 设备连接模式 clientId -> 'mqtt' | 'http'
    this.deviceMode = new Map();

    // HTTP模式设备的消息暂存 clientId -> [{message, timestamp}]
    this.pendingMessages = new Map();

    // 定时清理过期消息
    setInterval(() => this.cleanExpiredMessages(), config.cache.cleanupInterval);
  }

  /**
   * 设置设备信息（通过clientId）
   */
  setDeviceByClientId(clientId, deviceInfo) {
    this.deviceByClientId.set(clientId, deviceInfo);
  }

  /**
   * 获取设备信息（通过clientId）
   */
  getDeviceByClientId(clientId) {
    return this.deviceByClientId.get(clientId);
  }

  /**
   * 设置设备信息（通过authKey）
   */
  setDeviceByAuthKey(authKey, deviceInfo) {
    this.deviceByAuthKey.set(authKey, deviceInfo);
  }

  /**
   * 获取设备信息（通过authKey）
   */
  getDeviceByAuthKey(authKey) {
    return this.deviceByAuthKey.get(authKey);
  }

  /**
   * 删除设备缓存
   */
  removeDevice(clientId, authKey) {
    this.deviceByClientId.delete(clientId);
    this.deviceByAuthKey.delete(authKey);
    this.lastPublishTime.delete(clientId);
    this.deviceGroups.delete(clientId);
  }

  /**
   * 记录设备最后发布时间
   */
  setLastPublishTime(clientId, timestamp) {
    this.lastPublishTime.set(clientId, timestamp);
  }

  /**
   * 获取设备最后发布时间
   */
  getLastPublishTime(clientId) {
    return this.lastPublishTime.get(clientId) || 0;
  }

  /**
   * 检查发布频率限制
   * @returns {boolean} true表示允许发布，false表示频率过高
   */
  checkPublishRate(clientId) {
    const now = Date.now();
    const lastTime = this.getLastPublishTime(clientId);
    
    if (now - lastTime < config.message.publishRateLimit) {
      return false;
    }
    
    this.setLastPublishTime(clientId, now);
    return true;
  }

  /**
   * 设置设备在线
   */
  setClientOnline(clientId, client) {
    this.onlineClients.set(clientId, client);
  }

  /**
   * 设置设备离线
   */
  setClientOffline(clientId) {
    this.onlineClients.delete(clientId);
  }

  /**
   * 获取在线客户端
   */
  getOnlineClient(clientId) {
    return this.onlineClients.get(clientId);
  }

  /**
   * 检查客户端是否在线
   */
  isClientOnline(clientId) {
    return this.onlineClients.has(clientId);
  }

  /**
   * 设置设备连接模式
   */
  setDeviceMode(clientId, mode) {
    this.deviceMode.set(clientId, mode);
  }

  /**
   * 获取设备连接模式
   */
  getDeviceMode(clientId) {
    return this.deviceMode.get(clientId) || 'mqtt';
  }

  /**
   * 检查设备是否为HTTP模式
   */
  isHttpMode(clientId) {
    return this.getDeviceMode(clientId) === 'http';
  }

  /**
   * 添加待接收消息（HTTP模式设备）
   */
  addPendingMessage(clientId, message) {
    if (!this.pendingMessages.has(clientId)) {
      this.pendingMessages.set(clientId, []);
    }
    const messages = this.pendingMessages.get(clientId);
    messages.push({
      message: message,
      timestamp: Date.now()
    });
  }

  /**
   * 获取并清除待接收消息
   */
  getPendingMessages(clientId) {
    const messages = this.pendingMessages.get(clientId) || [];
    this.pendingMessages.delete(clientId);
    
    // 过滤掉过期消息，只返回消息内容
    const now = Date.now();
    return messages
      .filter(m => now - m.timestamp < config.message.expireTime)
      .map(m => m.message);
  }

  /**
   * 清理过期消息
   */
  cleanExpiredMessages() {
    const now = Date.now();
    for (const [clientId, messages] of this.pendingMessages.entries()) {
      const validMessages = messages.filter(m => now - m.timestamp < config.message.expireTime);
      if (validMessages.length === 0) {
        this.pendingMessages.delete(clientId);
      } else {
        this.pendingMessages.set(clientId, validMessages);
      }
    }
  }

  /**
   * 设置设备所属组
   */
  setDeviceGroups(clientId, groups) {
    this.deviceGroups.set(clientId, groups);
  }

  /**
   * 获取设备所属组
   */
  getDeviceGroups(clientId) {
    return this.deviceGroups.get(clientId) || [];
  }

  /**
   * 检查设备是否在指定组中
   */
  isDeviceInGroup(clientId, groupName) {
    const groups = this.getDeviceGroups(clientId);
    return groups.includes(groupName);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      cachedDevices: this.deviceByClientId.size,
      onlineClients: this.onlineClients.size
    };
  }
}

// 导出单例
const deviceCache = new DeviceCache();

module.exports = { deviceCache, DeviceCache };
