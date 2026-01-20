# 点灯Broker Lite API文档

## 目录
- [HTTP接口](#http接口)
  - [健康检查](#健康检查)
  - [设备注册](#设备注册)
  - [设备上线](#设备上线)
  - [HTTP发布消息](#http发布消息)
  - [HTTP获取消息](#http获取消息)
  - [添加设备到组](#添加设备到组)
  - [获取设备所属组](#获取设备所属组)
- [MQTT接口](#mqtt接口)
  - [MQTT连接](#mqtt连接)
  - [设备发布](#设备发布)
  - [设备订阅](#设备订阅)
  - [组发布](#组发布)
  - [组订阅](#组订阅)
- [错误码](#错误码)
- [限制机制](#限制机制)

---

## HTTP接口

基础URL: `http://localhost:3000`

### 健康检查

检查服务运行状态。

**请求**
```
GET /health
```

**响应**
```json
{
  "message": 1000,
  "detail": {
    "status": "ok",
    "cachedDevices": 10,
    "onlineClients": 5,
    "timestamp": "2026-01-21T10:00:00.000Z"
  }
}
```

---

### 设备注册

用于APP/WEB端创建新设备，获取设备的authKey。

**请求**
```
POST /device/auth
Content-Type: application/json
```

**请求体**
```json
{
  "uuid": "9140dxx9843bxxd6bc439exxxxxxxxxx",
  "token": "your_device_token"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| uuid | string | 是 | 设备唯一标识 |
| token | string | 是 | 设备令牌 |

**响应**
```json
{
  "message": 1000,
  "detail": {
    "authKey": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
  }
}
```

---

### 设备上线

设备获取连接信息，支持MQTT和HTTP两种模式。

**请求**
```
GET /device/auth?authKey={authKey}&mode={mode}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| authKey | string | 是 | 设备认证密钥 |
| mode | string | 否 | 连接模式：`mqtt`(默认) 或 `http` |

**响应 - MQTT模式**
```json
{
  "message": 1000,
  "detail": {
    "mode": "mqtt",
    "host": "mqtt://localhost",
    "port": "1883",
    "clientId": "device_abc123def456",
    "username": "user_9140dxx9",
    "password": "xxxxxxxxxxxxxxxxx",
    "uuid": "9140dxx9843bxxd6bc439exxxxxxxxxx"
  }
}
```

**响应 - HTTP模式**
```json
{
  "message": 1000,
  "detail": {
    "mode": "http",
    "clientId": "device_abc123def456",
    "authKey": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "uuid": "9140dxx9843bxxd6bc439exxxxxxxxxx"
  }
}
```

> **注意**：每次调用此接口都会重置连接凭证（iotToken），之前的凭证将失效。

---

### HTTP发布消息

通过HTTP接口发送消息给其他设备或组（需先以HTTP模式上线）。

**请求**
```
POST /device/s
Content-Type: application/json
```

**请求体 - 发送给设备**
```json
{
  "authKey": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "toDevice": "device_target123",
  "data": {
    "cmd": "setState",
    "value": 1
  }
}
```

**请求体 - 发送给组**
```json
{
  "authKey": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "toGroup": "my_group_name",
  "data": {
    "cmd": "broadcast",
    "value": "hello"
  }
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| authKey | string | 是 | 设备认证密钥 |
| toDevice | string | 否* | 目标设备的clientId |
| toGroup | string | 否* | 目标组名称 |
| data | object | 是 | 承载数据 |

> *toDevice 和 toGroup 至少需要一个

**响应**
```json
{
  "message": 1000,
  "detail": {
    "status": "published"
  }
}
```

---

### HTTP获取消息

获取暂存的消息（仅HTTP模式设备可用）。消息暂存时间为120秒，获取后自动清除。

**请求**
```
GET /device/r?authKey={authKey}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| authKey | string | 是 | 设备认证密钥 |

**响应**
```json
{
  "message": 1000,
  "detail": {
    "messages": [
      {
        "fromDevice": "device_sender123",
        "data": {
          "cmd": "setState",
          "value": 1
        }
      },
      {
        "fromGroup": "my_group",
        "fromDevice": "device_sender456",
        "data": {
          "cmd": "broadcast",
          "value": "hello"
        }
      }
    ],
    "count": 2
  }
}
```

> **注意**：只有以HTTP模式上线的设备才能使用此接口。

---

### 添加设备到组

将设备添加到指定组，用于组内通信。

**请求**
```
POST /device/group
Content-Type: application/json
```

**请求体**
```json
{
  "authKey": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "groupName": "my_group_name"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| authKey | string | 是 | 设备认证密钥 |
| groupName | string | 是 | 组名称（不存在则自动创建） |

**响应**
```json
{
  "message": 1000,
  "detail": {
    "status": "added",
    "groupName": "my_group_name"
  }
}
```

---

### 获取设备所属组

查询设备所在的所有组。

**请求**
```
GET /device/groups?authKey={authKey}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| authKey | string | 是 | 设备认证密钥 |

**响应**
```json
{
  "message": 1000,
  "detail": {
    "groups": ["default_group", "my_group_name"]
  }
}
```

---

## MQTT接口

### MQTT连接

使用从 `GET /device/auth` 获取的连接信息连接到MQTT Broker。

**连接参数**
| 参数 | 值 |
|------|------|
| Host | mqtt://localhost |
| Port | 1883 |
| Client ID | 从接口获取的 clientId |
| Username | 从接口获取的 username |
| Password | 从接口获取的 password |

**示例（Node.js）**
```javascript
const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://localhost:1883', {
  clientId: 'device_abc123def456',
  username: 'user_9140dxx9',
  password: 'xxxxxxxxxxxxxxxxx'
});

client.on('connect', () => {
  console.log('已连接到Broker');
});
```

---

### 设备发布

设备向指定设备发送消息。

**Topic**
```
/device/{clientId}/s
```
> `{clientId}` 为当前设备自己的clientId

**消息格式**
```json
{
  "toDevice": "device_target123",
  "data": {
    "get": "state"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| toDevice | string | 目标设备的clientId |
| data | object | 承载数据 |

**示例**
```javascript
client.publish('/device/device_abc123def456/s', JSON.stringify({
  toDevice: 'device_target123',
  data: { cmd: 'toggle', value: true }
}));
```

---

### 设备订阅

订阅接收发给自己的消息。

**Topic**
```
/device/{clientId}/r
```
> `{clientId}` 为当前设备自己的clientId

**接收消息格式**
```json
{
  "fromDevice": "device_sender123",
  "data": {
    "get": "state"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| fromDevice | string | 发送设备的clientId |
| data | object | 承载数据 |

**示例**
```javascript
client.subscribe('/device/device_abc123def456/r');

client.on('message', (topic, message) => {
  const data = JSON.parse(message.toString());
  console.log('收到消息:', data);
});
```

---

### 组发布

向组内所有设备广播消息。

**Topic**
```
/group/{groupName}/s
```

**消息格式**
```json
{
  "toGroup": "my_group_name",
  "data": {
    "get": "state"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| toGroup | string | 目标组名称 |
| data | object | 承载数据 |

**示例**
```javascript
client.publish('/group/my_group_name/s', JSON.stringify({
  toGroup: 'my_group_name',
  data: { cmd: 'sync', timestamp: Date.now() }
}));
```

---

### 组订阅

订阅组内的广播消息。

**Topic**
```
/group/{groupName}/r
```

**接收消息格式**
```json
{
  "fromGroup": "my_group_name",
  "fromDevice": "device_sender123",
  "data": {
    "get": "state"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| fromGroup | string | 来源组名称 |
| fromDevice | string | 发送设备的clientId |
| data | object | 承载数据 |

**示例**
```javascript
client.subscribe('/group/my_group_name/r');

client.on('message', (topic, message) => {
  const data = JSON.parse(message.toString());
  console.log('收到组消息:', data);
});
```

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| 1000 | 成功 |
| 1001 | 参数错误 |
| 1002 | 服务器内部错误 |
| 1003 | 设备不存在 |
| 1004 | 消息长度超过限制 |
| 1005 | 发布频率过高 |
| 1006 | 无权操作该组 |
| 1007 | 设备未以HTTP模式上线 |

---

## 限制机制

| 限制项 | 说明 |
|--------|------|
| authKey唯一性 | 一个authKey只能一个设备使用，每次获取连接信息都将重置iotToken |
| Topic权限 | 设备只能发布和订阅属于自身的topic，否则将被断开连接 |
| 发布频率 | 每秒最多发布1条消息，超过将被断开连接 |
| 消息长度 | 每条消息不能大于1024字节，否则将被断开连接 |
| 组权限 | 设备只能和所在组的其他设备通信，1个设备可以在多个组中 |
| HTTP消息暂存 | HTTP模式设备的消息暂存120秒，过期自动清除 |
