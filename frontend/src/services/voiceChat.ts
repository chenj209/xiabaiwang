import Peer from 'peerjs';
import { Socket } from 'socket.io-client';

class VoiceChat {
  private socket: Socket | null = null;
  private localStream: MediaStream | null = null;
  private myPeer: Peer | null = null;
  private connections: Map<string, any> = new Map();
  private roomId: string | null = null;
  private myId: string | null = null;
  private onVoiceStateChange: (isActive: boolean) => void = () => {};
  private isVoiceActive = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectTimer: number | null = null;

  init(socket: Socket, roomId: string, myId: string) {
    this.socket = socket;
    this.roomId = roomId;
    this.myId = myId;

    // Set up signaling event listeners
    socket.on('user-joined-voice', this.handleUserJoinedVoice);
    socket.on('user-left-voice', this.handleUserLeftVoice);
  }

  cleanup() {
    if (this.socket) {
      this.socket.off('user-joined-voice', this.handleUserJoinedVoice);
      this.socket.off('user-left-voice', this.handleUserLeftVoice);
    }
    
    this.stopVoice();
    this.socket = null;
    this.roomId = null;
    this.myId = null;
    this.reconnectAttempts = 0;
    
    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  setVoiceStateChangeHandler(handler: (isActive: boolean) => void) {
    this.onVoiceStateChange = handler;
  }

  private async getMediaStream(): Promise<MediaStream | null> {
    try {
      console.log("Requesting media permissions...");
      
      // Check if we're in a secure context (HTTPS or localhost)
      if (!window.isSecureContext) {
        console.error("Voice chat requires HTTPS connection. Current connection is not secure.");
        alert("语音聊天功能需要HTTPS连接。请使用HTTPS访问或在localhost环境下使用。");
        return null;
      }
      
      // Check if getUserMedia is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error("getUserMedia is not supported in this browser");
        alert("当前浏览器不支持语音聊天功能。请使用Chrome、Firefox或Edge等现代浏览器。");
        return null;
      }
      
      // Optimize audio constraints for voice chat
      const constraints = { 
        audio: { 
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1, // Mono audio is sufficient for voice
          sampleRate: 22050, // Lower sample rate for voice
          latency: 0 // Request low latency audio
        }, 
        video: false 
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log("Media access granted successfully");
      return stream;
    } catch (err: any) {
      console.error("Failed to get user media:", err);
      
      // Provide specific error messages based on the error type
      if (err.name === 'NotAllowedError') {
        alert("语音聊天需要麦克风权限。请在浏览器中允许麦克风访问。");
      } else if (err.name === 'NotFoundError') {
        alert("未找到麦克风设备。请检查您的麦克风是否已连接。");
      } else if (err.name === 'NotReadableError') {
        alert("无法访问麦克风。麦克风可能被其他应用程序占用。");
      } else if (err.name === 'OverconstrainedError') {
        alert("麦克风设置不兼容。请尝试使用其他麦克风设备。");
      } else if (err.name === 'NotSecureError' || err.message.includes('secure')) {
        alert("语音聊天功能需要HTTPS连接。请使用HTTPS访问网站。");
      } else {
        alert(`语音聊天功能启动失败：${err.message || '未知错误'}`);
      }
      
      return null;
    }
  }
  
  async startVoice() {
    if (!this.socket || !this.roomId || !this.myId || this.isVoiceActive) {
      return;
    }
    
    try {
      // Acquire media stream
      this.localStream = await this.getMediaStream();
      if (!this.localStream) {
        this.onVoiceStateChange(false);
        return;
      }
      
      // Create a unique peer ID
      const peerId = `voice-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
      
      // Create PeerJS instance with comprehensive STUN/TURN configuration for cross-network audio
      this.myPeer = new Peer(peerId, {
        config: {
          iceServers: [
            // TURN servers for relay connections (TURN-only configuration)
            {
              urls: 'turn:212.50.245.45:3478',
              username: '475789141',
              credential: '544413857@@'
            },
            // Backup TURN server (you can add more TURN servers here)
            {
              urls: 'turn:212.50.245.45:3478?transport=tcp',
              username: '475789141',
              credential: '544413857@@'
            }
          ],
          // Enable multiple candidates for better connectivity
          iceCandidatePoolSize: 10,
          // Force relay through TURN servers only (no direct or STUN connections)
          iceTransportPolicy: 'relay',
          // Ensure proper media flow
          bundlePolicy: 'max-bundle',
          rtcpMuxPolicy: 'require'
        },
        // Enable debug for connection issues
        debug: 1
      });
      
      // Set a timeout for connection
      const connectionTimeout = setTimeout(() => {
        if (!this.isVoiceActive && this.myPeer) {
          this.myPeer.destroy();
          this.myPeer = null;
          this.onVoiceStateChange(false);
        }
      }, 10000);
      
      // Handle peer open event
      this.myPeer.on('open', (id) => {
        clearTimeout(connectionTimeout);
        
        console.log(`✅ PeerJS connection opened with ID: ${id}`);
        console.log('🔧 TURN-only server configuration:', {
          urls: 'turn:212.50.245.45:3478',
          transportPolicy: 'relay-only'
        });
        
        this.isVoiceActive = true;
        this.onVoiceStateChange(true);
        this.reconnectAttempts = 0;
        
        // Store peer ID and join voice chat
        if (this.socket && this.roomId) {
          this.socket.emit('store-peer-id', { roomId: this.roomId, peerId: id });
          this.socket.emit('join-voice', { roomId: this.roomId, peerId: id });
        }
      });
      
      // Handle peer disconnection
      this.myPeer.on('disconnected', () => {
        try {
          this.myPeer?.reconnect();
        } catch (err) {
          this.attemptReconnect();
        }
      });
      
      // Handle peer errors
      this.myPeer.on('error', (err) => {
        clearTimeout(connectionTimeout);
        this.attemptReconnect();
      });
      
      // Handle incoming calls
      this.myPeer.on('call', (call) => {
        try {
          if (this.localStream) {
            call.answer(this.localStream);
            
            // Monitor ICE connection state for debugging
            if (call.peerConnection) {
              call.peerConnection.oniceconnectionstatechange = () => {
                console.log(`ICE connection state for incoming call: ${call.peerConnection?.iceConnectionState}`);
                if (call.peerConnection?.iceConnectionState === 'failed') {
                  console.error('ICE connection failed for incoming call');
                }
              };
              
              call.peerConnection.onicegatheringstatechange = () => {
                console.log(`ICE gathering state for incoming call: ${call.peerConnection?.iceGatheringState}`);
              };
              
              call.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                  console.log(`ICE candidate for incoming call:`, event.candidate.type, event.candidate.protocol);
                }
              };
            }
            
            call.on('stream', (remoteStream) => {
              console.log('Received stream from incoming call');
              this.createAudioElement(call.peer, remoteStream);
            });
            
            call.on('close', () => {
              console.log('Incoming call closed');
              this.removeAudioElement(call.peer);
            });
            
            call.on('error', (err) => {
              console.error('Incoming call error:', err);
              this.removeAudioElement(call.peer);
            });
            
            this.connections.set(call.peer, call);
          }
        } catch (err) {
          console.error("Error handling incoming call:", err);
        }
      });
      
    } catch (error) {
      this.isVoiceActive = false;
      this.onVoiceStateChange(false);
      this.cleanupResources();
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      
      // Clear any existing timer
      if (this.reconnectTimer) {
        window.clearTimeout(this.reconnectTimer);
      }
      
      // Exponential backoff (1s, 2s, 4s)
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 4000);
      
      this.reconnectTimer = window.setTimeout(() => {
        this.stopVoice();
        this.startVoice();
        this.reconnectTimer = null;
      }, delay);
    } else {
      this.stopVoice();
      this.onVoiceStateChange(false);
    }
  }

  private cleanupResources() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    if (this.myPeer) {
      this.myPeer.destroy();
      this.myPeer = null;
    }
    
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  stopVoice() {
    if (!this.isVoiceActive) return;
    
    // Close all connections
    this.connections.forEach((call) => {
      try {
        call.close();
      } catch (err) {
        console.error('Error closing call:', err);
      }
    });
    this.connections.clear();
    
    // Notify server that we left voice chat
    if (this.socket && this.roomId) {
      this.socket.emit('leave-voice', { roomId: this.roomId });
    }
    
    this.cleanupResources();
    
    // Remove all audio elements
    document.querySelectorAll('[id^="voice-"]').forEach(el => el.remove());
    
    this.isVoiceActive = false;
    this.onVoiceStateChange(false);
  }

  isActive() {
    return this.isVoiceActive;
  }

  toggleVoice() {
    if (this.isVoiceActive) {
      this.stopVoice();
    } else {
      this.startVoice();
    }
  }

  private handleUserJoinedVoice = (data: { userId: string, peerId?: string }) => {
    const { userId, peerId } = data;
    
    // Don't try to connect if we're not active or if it's ourselves
    if (!this.isVoiceActive || !this.myPeer || !this.localStream || userId === this.myId || !peerId) {
      return;
    }
    
    // Call the remote peer once with retry logic
    this.callPeer(peerId);
  };

  private handleUserLeftVoice = (data: { userId: string }) => {
    const { userId } = data;
    
    // Find and close any connection to this user
    this.connections.forEach((call, peerId) => {
      if (peerId.includes(userId)) {
        call.close();
        this.connections.delete(peerId);
        this.removeAudioElement(peerId);
      }
    });
  };

  private callPeer(peerId: string, retryCount = 0) {
    if (!this.myPeer || !this.localStream || retryCount >= 3) {
      return;
    }
    
    try {
      console.log(`Calling peer ${peerId}, attempt ${retryCount + 1}`);
      const call = this.myPeer.call(peerId, this.localStream);
      
      if (!call) {
        console.error("Failed to create call to peer:", peerId);
        return;
      }
      
      // Monitor connection state for audio transmission
      let audioReceived = false;
      const connectionMonitor = setInterval(() => {
        if (call.peerConnection) {
          const stats = call.peerConnection.getStats();
          if (stats) {
            stats.then((statsReport) => {
              statsReport.forEach((stat) => {
                if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
                  if (stat.bytesReceived > 0) {
                    audioReceived = true;
                    console.log(`Audio bytes received from ${peerId}:`, stat.bytesReceived);
                  }
                }
              });
            });
          }
        }
      }, 2000);
      
      // 设置连接超时
      const callTimeout = setTimeout(() => {
        console.log(`Call to ${peerId} timed out, attempting retry`);
        clearInterval(connectionMonitor);
        call.close();
        this.connections.delete(peerId);
        
        // 重试连接
        if (retryCount < 2) {
          console.log(`Retrying connection to ${peerId} in ${2000 * (retryCount + 1)}ms`);
          setTimeout(() => {
            this.callPeer(peerId, retryCount + 1);
          }, 2000 * (retryCount + 1));
        }
      }, 15000); // 15秒超时
      
      // Check for audio after connection established
      const audioCheckTimeout = setTimeout(() => {
        if (!audioReceived) {
          console.warn(`No audio received from ${peerId}, connection may be through restricted NAT`);
          // Don't close the call, but log the issue
        }
        clearInterval(connectionMonitor);
      }, 10000);
      
      call.on('stream', (remoteStream) => {
        clearTimeout(callTimeout);
        console.log(`Successfully received stream from peer ${peerId}`);
        
        // Monitor ICE connection state for outgoing calls
        if (call.peerConnection) {
          console.log(`🔗 Setting up ICE monitoring for call to ${peerId}`);
          
          call.peerConnection.oniceconnectionstatechange = () => {
            const state = call.peerConnection?.iceConnectionState;
            console.log(`🧊 ICE connection state with ${peerId}: ${state}`);
            
            if (state === 'failed') {
              console.error(`❌ ICE connection failed with ${peerId}`);
            } else if (state === 'connected') {
              console.log(`✅ ICE connection established with ${peerId}`);
            } else if (state === 'checking') {
              console.log(`🔍 ICE connectivity checks in progress with ${peerId}`);
            } else if (state === 'completed') {
              console.log(`🎉 ICE connection completed with ${peerId}`);
            }
          };
          
          call.peerConnection.onicegatheringstatechange = () => {
            const state = call.peerConnection?.iceGatheringState;
            console.log(`📡 ICE gathering state with ${peerId}: ${state}`);
          };
          
          call.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
              const candidate = event.candidate;
              console.log(`🎯 ICE candidate for ${peerId}:`, {
                type: candidate.type,
                protocol: candidate.protocol,
                address: candidate.address,
                port: candidate.port,
                foundation: candidate.foundation
              });
              
              if (candidate.type === 'relay') {
                console.log(`🔄 TURN relay candidate found for ${peerId} - excellent for cross-network!`, {
                  address: candidate.address,
                  port: candidate.port
                });
              } else if (candidate.type === 'srflx') {
                console.log(`🌐 STUN server-reflexive candidate for ${peerId}`, {
                  address: candidate.address,
                  port: candidate.port
                });
              } else if (candidate.type === 'host') {
                console.log(`🏠 Host candidate for ${peerId}`, {
                  address: candidate.address,
                  port: candidate.port
                });
              }
            } else {
              console.log(`🏁 ICE candidate gathering completed for ${peerId}`);
            }
          };
        }
        
        // Verify audio tracks
        const audioTracks = remoteStream.getAudioTracks();
        if (audioTracks.length > 0) {
          console.log(`Audio tracks received from ${peerId}:`, audioTracks.length);
          audioTracks.forEach((track, index) => {
            console.log(`Audio track ${index}:`, track.label, 'enabled:', track.enabled);
          });
        } else {
          console.warn(`No audio tracks in stream from ${peerId}`);
        }
        
        this.createAudioElement(peerId, remoteStream);
      });
      
      call.on('close', () => {
        clearTimeout(callTimeout);
        clearTimeout(audioCheckTimeout);
        clearInterval(connectionMonitor);
        console.log(`Call with peer ${peerId} closed`);
        this.removeAudioElement(peerId);
        this.connections.delete(peerId);
      });
      
      call.on('error', (err) => {
        clearTimeout(callTimeout);
        clearTimeout(audioCheckTimeout);
        clearInterval(connectionMonitor);
        console.error(`Call error with peer ${peerId}:`, err);
        this.removeAudioElement(peerId);
        this.connections.delete(peerId);
        
        // 如果是连接相关错误，尝试重连
        if (retryCount < 2) {
          console.log(`Retrying connection to ${peerId} in ${2000 * (retryCount + 1)}ms`);
          setTimeout(() => {
            this.callPeer(peerId, retryCount + 1);
          }, 2000 * (retryCount + 1));
        }
      });
      
      this.connections.set(peerId, call);
      
    } catch (error) {
      console.error("Error calling peer:", error);
      if (retryCount < 2) {
        setTimeout(() => {
          this.callPeer(peerId, retryCount + 1);
        }, 2000 * (retryCount + 1));
      }
    }
  }

  private createAudioElement(peerId: string, stream: MediaStream) {
    // Remove existing audio element if any
    this.removeAudioElement(peerId);
    
    try {
      console.log(`Creating audio element for peer ${peerId}`);
      
      // Verify stream has audio tracks
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        console.error(`No audio tracks in stream from ${peerId}`);
        return;
      }
      
      // Create optimized audio element
      const audio = document.createElement('audio');
      audio.id = `voice-${peerId}`;
      audio.srcObject = stream;
      audio.autoplay = true;
      
      // Critical audio settings for cross-network playback
      audio.setAttribute('playsinline', '');
      audio.muted = false;
      audio.volume = 1.0;
      audio.controls = false; // Hide controls but keep for debugging if needed
      
      // Add event listeners to monitor audio playback
      audio.addEventListener('loadedmetadata', () => {
        console.log(`Audio metadata loaded for ${peerId}`);
      });
      
      audio.addEventListener('canplay', () => {
        console.log(`Audio can play for ${peerId}`);
        audio.play().catch(err => {
          console.error(`Failed to play audio for ${peerId}:`, err);
          // Try to trigger play again after user interaction
          document.addEventListener('click', () => {
            audio.play().catch(e => console.error('Still failed to play:', e));
          }, { once: true });
        });
      });
      
      audio.addEventListener('playing', () => {
        console.log(`Audio started playing for ${peerId}`);
      });
      
      audio.addEventListener('ended', () => {
        console.log(`Audio ended for ${peerId}`);
      });
      
      audio.addEventListener('error', (e) => {
        console.error(`Audio error for ${peerId}:`, e);
      });
      
      // Monitor audio stream activity
      let lastBytesReceived = 0;
      const streamMonitor = setInterval(() => {
        const audioTrack = audioTracks[0];
        if (audioTrack && audioTrack.readyState === 'live') {
          // Check if audio is actually flowing
          if (audio.currentTime > 0 || audio.duration > 0) {
            console.log(`Audio active for ${peerId}, currentTime: ${audio.currentTime}`);
          }
        } else {
          console.warn(`Audio track not live for ${peerId}`);
        }
      }, 5000);
      
      // Clean up monitor when audio is removed
      audio.addEventListener('remove', () => {
        clearInterval(streamMonitor);
      });
      
      // Hide the audio element but make it functional
      audio.style.display = 'none';
      
      // Add to DOM
      document.body.appendChild(audio);
      
      console.log(`Audio element created and added for ${peerId}`);
      
    } catch (err) {
      console.error('Error creating audio element:', err);
    }
  }
  
  private removeAudioElement(peerId: string) {
    const audioElement = document.getElementById(`voice-${peerId}`);
    if (audioElement) {
      audioElement.remove();
    }
  }
}

// Export a singleton instance
export const voiceChat = new VoiceChat();
export default voiceChat; 