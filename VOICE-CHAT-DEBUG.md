# 语音聊天跨网络调试指南

## 问题描述
PeerJS能够连接，但只有在同一WiFi下的设备才能听到声音，不同网络下没有声音。

## 已实施的解决方案

### 1. TURN服务器配置
添加了多个TURN服务器来解决NAT穿透问题：
- OpenRelay (openrelay.metered.ca) - 支持UDP/TCP
- Backups.cz relay服务器
- Bistri.com TURN服务器

### 2. ICE配置优化
- `iceCandidatePoolSize: 10` - 增加候选连接数量
- `iceTransportPolicy: 'all'` - 允许所有传输类型
- `bundlePolicy: 'max-bundle'` - 优化媒体流传输
- `rtcpMuxPolicy: 'require'` - 确保RTCP复用

### 3. 连接监控
添加了详细的ICE连接状态监控和音频流检查。

## 测试步骤

### 1. 基本连接测试
1. 打开浏览器开发者工具（F12）
2. 进入游戏房间
3. 启动语音聊天
4. 查看Console日志

### 2. 跨网络测试
1. 设备A：连接WiFi网络
2. 设备B：使用手机热点或不同网络
3. 两设备都进入同一房间
4. 启动语音聊天并观察日志

### 3. 关键日志信息查看

#### 成功的连接应该显示：
```
ICE candidate with [peerId]: relay udp
Using TURN relay for [peerId] - good for cross-network!
ICE connection state with [peerId]: connected
Audio tracks received from [peerId]: 1
Audio started playing for [peerId]
```

#### 失败的连接可能显示：
```
ICE connection state with [peerId]: failed
No audio tracks in stream from [peerId]
Call to [peerId] timed out, attempting retry
```

## 常见问题和解决方案

### 1. ICE连接失败
**现象**: 看到 `ICE connection failed`
**原因**: TURN服务器不可用或被防火墙阻止
**解决**: 
- 检查网络防火墙设置
- 尝试其他TURN服务器
- 检查企业网络是否阻止WebRTC

### 2. 连接成功但无音频
**现象**: ICE连接成功，但听不到声音
**原因**: 音频轨道传输问题或浏览器策略
**解决**:
- 检查浏览器音频权限
- 确保使用HTTPS访问
- 检查音量设置

### 3. 音频延迟高
**现象**: 声音有明显延迟
**原因**: 通过TURN中继传输
**解决**: 这是正常现象，TURN中继会增加延迟

## 高级调试

### 1. WebRTC内部统计
打开 `chrome://webrtc-internals/` 查看详细连接统计。

### 2. 网络连通性测试
使用以下网站测试STUN/TURN服务器：
- https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

### 3. 自定义TURN服务器
如果免费TURN服务器不稳定，可以考虑：

#### 使用Coturn搭建自己的TURN服务器：
```bash
# Ubuntu/Debian安装
sudo apt-get install coturn

# 配置文件 /etc/turnserver.conf
listening-port=3478
tls-listening-port=5349
listening-ip=YOUR_SERVER_IP
external-ip=YOUR_SERVER_IP
realm=YOUR_DOMAIN
server-name=YOUR_DOMAIN
lt-cred-mech
user=username:password
```

#### 商业TURN服务
- Twilio: https://www.twilio.com/stun-turn
- Agora: https://www.agora.io/
- Xirsys: https://xirsys.com/

## 配置文件更新

如果需要使用自定义TURN服务器，修改 `frontend/src/services/voiceChat.ts` 中的 `iceServers` 配置：

```typescript
iceServers: [
  // 你的STUN服务器
  { urls: 'stun:your-stun-server.com:3478' },
  
  // 你的TURN服务器
  {
    urls: 'turn:your-turn-server.com:3478',
    username: 'your-username',
    credential: 'your-password'
  }
]
```

## 网络要求

### 端口要求
- UDP: 1024-65535 (RTP媒体流)
- TCP: 443, 80 (TURN over TCP)
- STUN: 3478, 19302

### 防火墙配置
确保出站连接允许访问：
- Google STUN服务器
- 配置的TURN服务器
- WebRTC媒体端口范围

## 故障排除清单

- [ ] HTTPS连接 (语音聊天需要安全上下文)
- [ ] 麦克风权限已授予
- [ ] 防火墙允许WebRTC流量
- [ ] TURN服务器可访问
- [ ] 不同网络环境测试
- [ ] 浏览器支持WebRTC (Chrome/Firefox/Edge)
- [ ] 网络管理员允许WebRTC (企业网络)

## 性能优化建议

1. **音频质量vs带宽**: 当前配置优化了音频质量，如需降低带宽使用，可调整音频约束
2. **连接稳定性**: TURN中继连接更稳定但延迟更高
3. **用户体验**: 添加连接状态指示器帮助用户了解连接状态

## 技术支持

如果问题仍然存在，请提供：
1. 浏览器Console完整日志
2. 网络环境描述（WiFi/移动网络/企业网络）
3. 测试的设备和浏览器版本
4. `chrome://webrtc-internals/` 的统计信息 