/**
 * 设备缓存管理
 * 使用Map进行内存缓存，提升访问性能
 */
import { Client as AedesClient } from 'aedes';
import config from './config';
import {
  Device,
  DeviceMode,
  ForwardMessage,
  PendingMessage,
  CacheStats,
  IDeviceCache
} from './types';

export class DeviceCache implements IDeviceCache {
  // 设备信息缓存 clientId -> deviceInfo
  deviceByClientId: Map<string, Device>;
  
  // 设备信息缓存 authKey -> deviceInfo
  private deviceByAuthKey: Map<string, Device>;
  
  // 设备最后发布时间 clientId -> timestamp
  private lastPublishTime: Map<string, number>;
  
  // 在线设备 clientId -> client
  private onlineClients: Map<string, AedesClient>;
  
  // 设备组缓存 clientId -> groupNames[]
  private deviceGroupsMap: Map<string, string[]>;

  // 设备连接模式 clientId -> 'mqtt' | 'http'
  private deviceModeMap: Map<string, DeviceMode>;

  // HTTP模式设备的消息暂存 clientId -> [{message, timestamp}]
  private pendingMessages: Map<string, PendingMessage[]>;

  // 组成员反向索引 groupName -> Set<clientId>
  private groupMembersIndex: Map<string, Set<string>>;

  // HTTP设备最后活动时间 clientId -> timestamp
  private httpDeviceLastActive: Map<string, number>;

  // 清理定时器
  private cleanupTimer: NodeJS.Timeout;

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
    this.deviceGroupsMap = new Map();

    // 设备连接模式 clientId -> 'mqtt' | 'http'
    this.deviceModeMap = new Map();

    // HTTP模式设备的消息暂存 clientId -> [{message, timestamp}]
    this.pendingMessages = new Map();

    // 组成员反向索引 groupName -> Set<clientId>
    this.groupMembersIndex = new Map();

    // HTTP设备最后活动时间 clientId -> timestamp
    this.httpDeviceLastActive = new Map();

    // 定时清理过期消息
    this.cleanupTimer = setInterval(() => this.cleanExpiredMessages(), config.cache.cleanupInterval);
  }

  /**
   * 设置设备信息（通过clientId）
   */
  setDeviceByClientId(clientId: string, deviceInfo: Device): void {
    this.deviceByClientId.set(clientId, deviceInfo);
  }

  /**
   * 获取设备信息（通过clientId）
   */
  getDeviceByClientId(clientId: string): Device | undefined {
    return this.deviceByClientId.get(clientId);
  }

  /**
   * 设置设备信息（通过authKey）
   */
  setDeviceByAuthKey(authKey: string, deviceInfo: Device): void {
    this.deviceByAuthKey.set(authKey, deviceInfo);
  }

  /**
   * 获取设备信息（通过authKey）
   */
  getDeviceByAuthKey(authKey: string): Device | undefined {
    return this.deviceByAuthKey.get(authKey);
  }

  /**
   * 删除设备缓存
   */
  removeDevice(clientId: string, authKey: string): void {
    // 从组反向索引中移除
    const groups = this.deviceGroupsMap.get(clientId) || [];
    for (const groupName of groups) {
      const members = this.groupMembersIndex.get(groupName);
      if (members) {
        members.delete(clientId);
        if (members.size === 0) {
          this.groupMembersIndex.delete(groupName);
        }
      }
    }

    this.deviceByClientId.delete(clientId);
    this.deviceByAuthKey.delete(authKey);
    this.lastPublishTime.delete(clientId);
    this.deviceGroupsMap.delete(clientId);
  }

  /**
   * 记录设备最后发布时间
   */
  setLastPublishTime(clientId: string, timestamp: number): void {
    this.lastPublishTime.set(clientId, timestamp);
  }

  /**
   * 获取设备最后发布时间
   */
  getLastPublishTime(clientId: string): number {
    return this.lastPublishTime.get(clientId) || 0;
  }

  /**
   * 检查发布频率限制
   * @returns true表示允许发布，false表示频率过高
   */
  checkPublishRate(clientId: string): boolean {
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
  setClientOnline(clientId: string, client: AedesClient): void {
    this.onlineClients.set(clientId, client);
  }

  /**
   * 设置设备离线
   */
  setClientOffline(clientId: string): void {
    this.onlineClients.delete(clientId);
  }

  /**
   * 获取在线客户端
   */
  getOnlineClient(clientId: string): AedesClient | undefined {
    return this.onlineClients.get(clientId);
  }

  /**
   * 检查客户端是否在线
   */
  isClientOnline(clientId: string): boolean {
    return this.onlineClients.has(clientId);
  }

  /**
   * 设置设备连接模式
   */
  setDeviceMode(clientId: string, mode: DeviceMode): void {
    this.deviceModeMap.set(clientId, mode);
  }

  /**
   * 获取设备连接模式
   */
  getDeviceMode(clientId: string): DeviceMode {
    return this.deviceModeMap.get(clientId) || 'mqtt';
  }

  /**
   * 检查设备是否为HTTP模式
   */
  isHttpMode(clientId: string): boolean {
    return this.getDeviceMode(clientId) === 'http';
  }

  /**
   * 添加待接收消息（HTTP模式设备）
   */
  addPendingMessage(clientId: string, message: ForwardMessage): void {
    if (!this.pendingMessages.has(clientId)) {
      this.pendingMessages.set(clientId, []);
    }
    const messages = this.pendingMessages.get(clientId)!;
    messages.push({
      message: message,
      timestamp: Date.now()
    });
  }

  /**
   * 获取并清除待接收消息
   */
  getPendingMessages(clientId: string): ForwardMessage[] {
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
  cleanExpiredMessages(): void {
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
  setDeviceGroups(clientId: string, groups: string[]): void {
    // 先从旧的组中移除
    const oldGroups = this.deviceGroupsMap.get(clientId) || [];
    for (const groupName of oldGroups) {
      const members = this.groupMembersIndex.get(groupName);
      if (members) {
        members.delete(clientId);
        if (members.size === 0) {
          this.groupMembersIndex.delete(groupName);
        }
      }
    }

    // 设置新的组
    this.deviceGroupsMap.set(clientId, groups);

    // 更新反向索引
    for (const groupName of groups) {
      if (!this.groupMembersIndex.has(groupName)) {
        this.groupMembersIndex.set(groupName, new Set());
      }
      this.groupMembersIndex.get(groupName)!.add(clientId);
    }
  }

  /**
   * 获取设备所属组
   */
  getDeviceGroups(clientId: string): string[] {
    return this.deviceGroupsMap.get(clientId) || [];
  }

  /**
   * 获取组内所有成员（使用反向索引，O(1) 复杂度）
   */
  getGroupMembers(groupName: string): string[] {
    const members = this.groupMembersIndex.get(groupName);
    return members ? Array.from(members) : [];
  }

  /**
   * 检查设备是否在指定组中
   */
  isDeviceInGroup(clientId: string, groupName: string): boolean {
    const groups = this.getDeviceGroups(clientId);
    return groups.includes(groupName);
  }

  /**
   * 获取统计信息
   */
  getStats(): CacheStats {
    return {
      cachedDevices: this.deviceByClientId.size,
      onlineClients: this.onlineClients.size
    };
  }

  /**
   * 记录HTTP设备最后活动时间
   */
  setHttpDeviceLastActive(clientId: string): void {
    this.httpDeviceLastActive.set(clientId, Date.now());
  }

  /**
   * 获取HTTP设备最后活动时间
   */
  getHttpDeviceLastActive(clientId: string): number {
    return this.httpDeviceLastActive.get(clientId) || 0;
  }

  /**
   * 获取所有在线MQTT客户端的clientId列表
   */
  getOnlineMqttClientIds(): string[] {
    const mqttClientIds: string[] = [];
    for (const [clientId] of this.onlineClients) {
      if (this.getDeviceMode(clientId) === 'mqtt') {
        mqttClientIds.push(clientId);
      }
    }
    return mqttClientIds;
  }

  /**
   * 销毁缓存实例
   */
  destroy(): void {
    clearInterval(this.cleanupTimer);
  }
}

// 导出单例
export const deviceCache = new DeviceCache();
