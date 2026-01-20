const { getDeviceByClientId, getDeviceGroups, isDeviceInGroup } = require('./database');
const config = require('./config');

/**
 * 设置MQTT Broker逻辑
 */
function setupBroker(aedes, deviceCache) {
  
  /**
   * 客户端认证
   */
  aedes.authenticate = (client, username, password, callback) => {
    const clientId = client.id;
    const passwordStr = password ? password.toString() : '';

    console.log(`[AUTH] 客户端尝试认证: ${clientId}, 用户名: ${username}`);

    // 从数据库获取设备信息
    const device = getDeviceByClientId(clientId);
    
    if (!device) {
      console.log(`[AUTH] 认证失败: 设备不存在 ${clientId}`);
      const error = new Error('设备不存在');
      error.returnCode = 4; // Bad username or password
      return callback(error, false);
    }

    // 验证用户名和密码
    if (device.username !== username || device.password !== passwordStr) {
      console.log(`[AUTH] 认证失败: 凭证错误 ${clientId}`);
      const error = new Error('用户名或密码错误');
      error.returnCode = 4;
      return callback(error, false);
    }

    console.log(`[AUTH] 认证成功: ${clientId}`);
    
    // 缓存设备信息
    deviceCache.setDeviceByClientId(clientId, device);
    
    // 加载设备组到缓存
    const groups = getDeviceGroups(device.id);
    const groupNames = groups.map(g => g.name);
    deviceCache.setDeviceGroups(clientId, groupNames);

    callback(null, true);
  };

  /**
   * 授权发布
   */
  aedes.authorizePublish = (client, packet, callback) => {
    const clientId = client.id;
    const topic = packet.topic;
    const payload = packet.payload.toString();

    console.log(`[PUBLISH] 客户端 ${clientId} 尝试发布到: ${topic}`);

    // 检查消息长度限制（限制机制4）
    if (payload.length > config.message.maxLength) {
      console.log(`[PUBLISH] 消息过长，断开连接: ${clientId}`);
      client.close();
      return callback(new Error(`消息长度超过${config.message.maxLength}`));
    }

    // 检查发布频率限制（限制机制3）
    if (!deviceCache.checkPublishRate(clientId)) {
      console.log(`[PUBLISH] 发布频率过高，断开连接: ${clientId}`);
      client.close();
      return callback(new Error('发布频率过高'));
    }

    // 获取设备信息
    const device = deviceCache.getDeviceByClientId(clientId);
    if (!device) {
      console.log(`[PUBLISH] 设备信息不存在: ${clientId}`);
      return callback(new Error('设备未认证'));
    }

    // 检查topic权限（限制机制2）
    const isAuthorized = checkTopicPermission(clientId, topic, 'publish', device, deviceCache);
    
    if (!isAuthorized) {
      console.log(`[PUBLISH] 无权发布到topic，断开连接: ${clientId} -> ${topic}`);
      client.close();
      return callback(new Error('无权发布到此topic'));
    }

    console.log(`[PUBLISH] 发布授权成功: ${clientId} -> ${topic}`);
    callback(null);
  };

  /**
   * 授权订阅
   */
  aedes.authorizeSubscribe = (client, sub, callback) => {
    const clientId = client.id;
    const topic = sub.topic;

    console.log(`[SUBSCRIBE] 客户端 ${clientId} 尝试订阅: ${topic}`);

    // 获取设备信息
    const device = deviceCache.getDeviceByClientId(clientId);
    if (!device) {
      console.log(`[SUBSCRIBE] 设备信息不存在: ${clientId}`);
      return callback(new Error('设备未认证'));
    }

    // 检查topic权限（限制机制2）
    const isAuthorized = checkTopicPermission(clientId, topic, 'subscribe', device, deviceCache);
    
    if (!isAuthorized) {
      console.log(`[SUBSCRIBE] 无权订阅topic，断开连接: ${clientId} -> ${topic}`);
      client.close();
      return callback(new Error('无权订阅此topic'));
    }

    console.log(`[SUBSCRIBE] 订阅授权成功: ${clientId} -> ${topic}`);
    callback(null, sub);
  };

  /**
   * 客户端连接事件
   */
  aedes.on('client', (client) => {
    console.log(`[CONNECT] 客户端已连接: ${client.id}`);
    deviceCache.setClientOnline(client.id, client);
  });

  /**
   * 客户端断开连接事件
   */
  aedes.on('clientDisconnect', (client) => {
    console.log(`[DISCONNECT] 客户端已断开: ${client.id}`);
    deviceCache.setClientOffline(client.id);
  });

  /**
   * 客户端错误事件
   */
  aedes.on('clientError', (client, error) => {
    console.log(`[ERROR] 客户端错误 ${client.id}: ${error.message}`);
  });

  /**
   * 发布事件 - 处理消息转发
   */
  aedes.on('publish', (packet, client) => {
    if (!client) return; // 系统消息忽略

    const topic = packet.topic;
    const payload = packet.payload.toString();

    console.log(`[MESSAGE] ${client.id} 发布消息到 ${topic}: ${payload.substring(0, 100)}...`);

    try {
      const message = JSON.parse(payload);

      // 处理设备间消息转发
      if (topic.startsWith('/device/') && topic.endsWith('/s')) {
        handleDeviceMessage(aedes, client, message, deviceCache);
      }
      
      // 处理组消息转发
      if (topic.startsWith('/group/') && topic.endsWith('/s')) {
        handleGroupMessage(aedes, client, topic, message, deviceCache);
      }
    } catch (error) {
      console.log(`[MESSAGE] 消息解析失败: ${error.message}`);
    }
  });

  /**
   * 订阅事件
   */
  aedes.on('subscribe', (subscriptions, client) => {
    console.log(`[SUBSCRIBE] ${client.id} 订阅了: ${subscriptions.map(s => s.topic).join(', ')}`);
  });

  /**
   * 取消订阅事件
   */
  aedes.on('unsubscribe', (subscriptions, client) => {
    console.log(`[UNSUBSCRIBE] ${client.id} 取消订阅: ${subscriptions.join(', ')}`);
  });
}

/**
 * 检查topic权限
 */
function checkTopicPermission(clientId, topic, action, device, deviceCache) {
  // 设备topic格式: /device/{clientId}/s 或 /device/{clientId}/r
  const deviceTopicRegex = /^\/device\/([^/]+)\/(s|r)$/;
  const deviceMatch = topic.match(deviceTopicRegex);
  
  if (deviceMatch) {
    const topicClientId = deviceMatch[1];
    const direction = deviceMatch[2];
    
    // 设备只能发布到自己的/s topic
    if (action === 'publish' && direction === 's') {
      return topicClientId === clientId;
    }
    
    // 设备只能订阅自己的/r topic
    if (action === 'subscribe' && direction === 'r') {
      return topicClientId === clientId;
    }
    
    return false;
  }

  // 组topic格式: /group/{groupName}/s 或 /group/{groupName}/r
  const groupTopicRegex = /^\/group\/([^/]+)\/(s|r)$/;
  const groupMatch = topic.match(groupTopicRegex);
  
  if (groupMatch) {
    const groupName = groupMatch[1];
    const direction = groupMatch[2];
    
    // 检查设备是否在该组中（限制机制5）
    const isInGroup = deviceCache.isDeviceInGroup(clientId, groupName);
    
    if (!isInGroup) {
      // 从数据库二次检查
      const dbCheck = isDeviceInGroup(device.id, groupName);
      if (!dbCheck) {
        return false;
      }
    }
    
    return true;
  }

  // 其他topic不允许
  return false;
}

/**
 * 处理设备间消息转发
 */
function handleDeviceMessage(aedes, client, message, deviceCache) {
  const { toDevice, data } = message;
  
  if (!toDevice || !data) {
    console.log('[FORWARD] 消息格式错误，缺少toDevice或data');
    return;
  }

  // 构造转发消息
  const forwardMessage = {
    fromDevice: client.id,
    data: data
  };

  // 检查目标设备是否为HTTP模式
  if (deviceCache.isHttpMode(toDevice)) {
    // HTTP模式：暂存消息，等待设备通过HTTP接口获取
    deviceCache.addPendingMessage(toDevice, forwardMessage);
    console.log(`[FORWARD] 消息已暂存给HTTP设备: ${toDevice}`);
    return;
  }

  // MQTT模式：发送到目标设备的接收topic
  const targetTopic = `/device/${toDevice}/r`;
  
  aedes.publish({
    topic: targetTopic,
    payload: JSON.stringify(forwardMessage),
    qos: 0,
    retain: false
  }, (error) => {
    if (error) {
      console.log(`[FORWARD] 转发消息失败: ${error.message}`);
    } else {
      console.log(`[FORWARD] 消息已转发到 ${targetTopic}`);
    }
  });
}

/**
 * 处理组消息转发
 */
function handleGroupMessage(aedes, client, topic, message, deviceCache) {
  const { toGroup, data } = message;
  
  if (!toGroup || !data) {
    console.log('[GROUP] 消息格式错误，缺少toGroup或data');
    return;
  }

  // 检查发送者是否在目标组中
  if (!deviceCache.isDeviceInGroup(client.id, toGroup)) {
    console.log(`[GROUP] 设备 ${client.id} 不在组 ${toGroup} 中，拒绝转发`);
    return;
  }

  // 构造转发消息
  const forwardMessage = {
    fromGroup: toGroup,
    fromDevice: client.id,
    data: data
  };

  // 遍历所有在线设备，为HTTP模式的设备暂存消息
  for (const [clientId, deviceInfo] of deviceCache.deviceByClientId.entries()) {
    if (clientId !== client.id && deviceCache.isDeviceInGroup(clientId, toGroup)) {
      if (deviceCache.isHttpMode(clientId)) {
        deviceCache.addPendingMessage(clientId, forwardMessage);
        console.log(`[GROUP] 组消息已暂存给HTTP设备: ${clientId}`);
      }
    }
  }

  // 发送到组的接收topic（MQTT设备会通过订阅收到）
  const targetTopic = `/group/${toGroup}/r`;
  
  aedes.publish({
    topic: targetTopic,
    payload: JSON.stringify(forwardMessage),
    qos: 0,
    retain: false
  }, (error) => {
    if (error) {
      console.log(`[GROUP] 组消息转发失败: ${error.message}`);
    } else {
      console.log(`[GROUP] 消息已转发到组 ${toGroup}`);
    }
  });
}

module.exports = { setupBroker };
