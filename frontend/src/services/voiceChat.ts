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
  private hasUserInteracted = false; // Track if user has interacted

  init(socket: Socket, roomId: string, myId: string) {
    this.socket = socket;
    this.roomId = roomId;
    this.myId = myId;

    // Set up signaling event listeners
    socket.on('user-joined-voice', this.handleUserJoinedVoice);
    socket.on('user-left-voice', this.handleUserLeftVoice);
    
    // Set up global user interaction handler for audio
    this.setupGlobalAudioEnablement();
  }

  private setupGlobalAudioEnablement() {
    if (this.hasUserInteracted) return;
    
    const enableAllAudio = async () => {
      if (this.hasUserInteracted) return;
      
      console.log('🖱️ User interaction detected - enabling all voice chat audio...');
      this.hasUserInteracted = true;
      
      // Enable all existing audio elements
      document.querySelectorAll('[id^="voice-"]').forEach((audioEl) => {
        const audio = audioEl as HTMLAudioElement;
        audio.muted = false;
        audio.volume = 1.0;
        audio.play().catch(err => 
          console.log(`Could not play audio for ${audio.id}:`, err.message)
        );
      });
      
      // Remove listeners after first interaction
      document.removeEventListener('click', enableAllAudio);
      document.removeEventListener('keydown', enableAllAudio);
      document.removeEventListener('touchstart', enableAllAudio);
    };
    
    // Listen for any user interaction
    document.addEventListener('click', enableAllAudio, { once: true });
    document.addEventListener('keydown', enableAllAudio, { once: true });
    document.addEventListener('touchstart', enableAllAudio, { once: true });
    
    console.log('🔒 Global audio enablement set up - click anywhere to enable voice chat');
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
      console.log("✅ Media access granted successfully");
      
      // Validate and log audio tracks
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        console.error("❌ No audio tracks in local stream");
        return null;
      }
      
      audioTracks.forEach((track, index) => {
        console.log(`🎤 Local audio track ${index}:`, {
          label: track.label,
          enabled: track.enabled,
          readyState: track.readyState,
          muted: track.muted,
          settings: track.getSettings(),
          capabilities: track.getCapabilities()
        });
        
        // Ensure track is enabled
        track.enabled = true;
        
        // Monitor track state changes
        track.addEventListener('ended', () => {
          console.warn(`⚠️ Local audio track ${index} ended`);
        });
        
        track.addEventListener('mute', () => {
          console.warn(`⚠️ Local audio track ${index} muted`);
        });
        
        track.addEventListener('unmute', () => {
          console.log(`🔊 Local audio track ${index} unmuted`);
        });
      });
      
      // Create audio context to monitor microphone input levels
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        source.connect(analyser);
        
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // Monitor audio levels periodically
        const monitorLevels = () => {
          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          
          if (average > 0) {
            console.log(`🎙️ Microphone input level: ${Math.round(average)}/255`);
          } else {
            console.warn(`⚠️ No microphone input detected (level: ${average})`);
          }
        };
        
        // Check levels every 5 seconds
        const levelMonitor = setInterval(monitorLevels, 5000);
        
        // Clean up when stream ends
        stream.addEventListener('inactive', () => {
          clearInterval(levelMonitor);
          audioContext.close();
        });
        
      } catch (audioContextError) {
        console.warn("⚠️ Could not create audio context for monitoring:", audioContextError);
      }
      
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
      
      // Check and fix audio track properties with aggressive unmuting
      audioTracks.forEach((track, index) => {
        console.log(`Audio track ${index} for ${peerId}:`, {
          label: track.label,
          enabled: track.enabled,
          readyState: track.readyState,
          muted: track.muted
        });
        
        // Ensure track is enabled
        track.enabled = true;
        
        // CRITICAL FIX: Aggressively handle muted tracks
        if (track.muted) {
          console.error(`🔇 CRITICAL: Audio track ${index} for ${peerId} is MUTED - attempting to fix...`);
          
          // Attempt 1: Try to clone the track (sometimes fixes muting issues)
          try {
            const clonedTrack = track.clone();
            if (!clonedTrack.muted) {
              console.log(`🔧 Successfully cloned unmuted track for ${peerId}`);
              // Replace the track in the stream
              stream.removeTrack(track);
              stream.addTrack(clonedTrack);
              audioTracks[index] = clonedTrack;
            }
          } catch (cloneErr) {
            console.warn(`⚠️ Could not clone track for ${peerId}:`, cloneErr);
          }
        }
        
        // Add track event listeners for real-time monitoring and fixing
        track.addEventListener('mute', () => {
          console.warn(`🔇 Audio track ${index} for ${peerId} became muted - attempting to fix...`);
          this.attemptTrackUnmute(peerId, track, stream);
        });
        
        track.addEventListener('unmute', () => {
          console.log(`🔊 Audio track ${index} for ${peerId} became unmuted - audio should work now!`);
          // Try to play audio again if it was paused due to muting
          if (audio.paused) {
            audio.play().catch(err => console.warn(`Could not restart audio after unmute:`, err));
          }
        });
        
        // IMPORTANT: Log guidance for muted tracks
        if (track.muted) {
          console.log(`🚨 SOLUTION: The remote user needs to click on their page to enable their microphone, OR you need to click to enable audio playback`);
        }
        
        track.addEventListener('ended', () => {
          console.warn(`⚠️ Audio track ${index} for ${peerId} ended`);
        });
      });
      
      // Create optimized audio element
      const audio = document.createElement('audio');
      audio.id = `voice-${peerId}`;
      
      // Critical audio settings for cross-network playback
      audio.setAttribute('playsinline', '');
      audio.setAttribute('autoplay', '');
      audio.muted = false;
      audio.volume = 1.0;
      audio.controls = false;
      
      // Set srcObject and handle the promise
      audio.srcObject = stream;
      
      // Create a promise-based approach for better audio handling
      const initializeAudio = async () => {
        try {
          // Wait for metadata to load
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Metadata load timeout')), 5000);
            audio.addEventListener('loadedmetadata', () => {
              clearTimeout(timeout);
              console.log(`✅ Audio metadata loaded for ${peerId}`);
              resolve(undefined);
            }, { once: true });
            
            audio.addEventListener('error', (e) => {
              clearTimeout(timeout);
              reject(e);
            }, { once: true });
          });
          
          // Try to play audio
          console.log(`🎵 Attempting to play audio for ${peerId}...`);
          await audio.play();
          console.log(`🎉 Audio successfully started playing for ${peerId}`);
          
        } catch (err: any) {
          console.warn(`⚠️ Autoplay blocked for ${peerId}:`, err.message);
          
          // Handle autoplay restrictions
          if (err.name === 'NotAllowedError' || err.message.includes('play')) {
            console.log(`🔒 Browser blocked autoplay for ${peerId}. Setting up user interaction handler...`);
            
            // Create a one-time click handler to enable audio
            const enableAudio = async () => {
              try {
                console.log(`🖱️ User interaction detected, enabling audio for ${peerId}...`);
                await audio.play();
                console.log(`🎉 Audio enabled for ${peerId} after user interaction`);
                document.removeEventListener('click', enableAudio);
                document.removeEventListener('keydown', enableAudio);
              } catch (playErr) {
                console.error(`❌ Failed to enable audio for ${peerId}:`, playErr);
              }
            };
            
            // Listen for any user interaction
            document.addEventListener('click', enableAudio, { once: true });
            document.addEventListener('keydown', enableAudio, { once: true });
            
            // Show a subtle notification
            console.log(`💡 Click anywhere to enable voice from ${peerId}`);
          }
        }
      };
      
      // Enhanced event listeners
      audio.addEventListener('playing', () => {
        console.log(`🎵 Audio started playing for ${peerId}`);
      });
      
      audio.addEventListener('pause', () => {
        console.log(`⏸️ Audio paused for ${peerId}`);
        // Try to resume if it shouldn't be paused
        if (!audio.ended) {
          audio.play().catch(err => console.log(`Resume failed for ${peerId}:`, err));
        }
      });
      
      audio.addEventListener('ended', () => {
        console.log(`🔚 Audio ended for ${peerId}`);
      });
      
      audio.addEventListener('error', (e) => {
        console.error(`❌ Audio error for ${peerId}:`, e);
      });
      
      audio.addEventListener('stalled', () => {
        console.warn(`🔄 Audio stalled for ${peerId}`);
      });
      
      audio.addEventListener('waiting', () => {
        console.log(`⏳ Audio waiting for data from ${peerId}`);
      });
      
      // Monitor audio stream activity with better live stream detection
      const streamMonitor = setInterval(() => {
        const audioTrack = audioTracks[0];
        
        if (audioTrack && audioTrack.readyState === 'live') {
          // For LIVE streams, currentTime often stays at 0, which is NORMAL
          const isPlaying = !audio.paused && !audio.ended && audio.readyState > 2;
          const currentTime = audio.currentTime;
          const duration = audio.duration;
          
          // Enhanced diagnostics for live streams
          const streamStatus = {
            isPlaying,
            currentTime,
            duration: isNaN(duration) ? 'live-stream' : duration,
            readyState: audio.readyState,
            paused: audio.paused,
            muted: audio.muted,
            volume: audio.volume,
            trackMuted: audioTrack.muted, // CRITICAL: Check if the track itself is muted
            trackEnabled: audioTrack.enabled,
            trackReadyState: audioTrack.readyState
          };
          
          // Log status with appropriate indicators
          if (audioTrack.muted) {
            console.error(`🔇 CRITICAL: Audio track for ${peerId} is MUTED - no sound will be heard!`, streamStatus);
            console.log(`💡 TIP: This usually means the remote user's microphone is muted or there's a connection issue`);
          } else if (isPlaying) {
            console.log(`✅ Live audio stream active for ${peerId}:`, streamStatus);
            console.log(`📝 Note: currentTime=0 is NORMAL for live audio streams`);
          } else {
            console.warn(`⚠️ Audio element not playing for ${peerId}:`, streamStatus);
          }
          
          // Try to play if it's not playing but should be
          if (!isPlaying && !audio.paused && !audioTrack.muted) {
            console.log(`🔄 Attempting to restart audio for ${peerId}...`);
            audio.play().catch(err => console.log(`Restart failed for ${peerId}:`, err));
          }
          
          // Check for potential issues
          if (audio.muted && !audioTrack.muted) {
            console.warn(`🔧 Audio element is muted but track is not - fixing...`);
            audio.muted = false;
          }
          
        } else {
          console.warn(`⚠️ Audio track not live for ${peerId}, readyState:`, audioTrack?.readyState);
          if (audioTrack) {
            console.log(`🔍 Track details:`, {
              readyState: audioTrack.readyState,
              enabled: audioTrack.enabled,
              muted: audioTrack.muted,
              id: audioTrack.id,
              label: audioTrack.label
            });
          }
        }
      }, 3000);
      
      // Add audio analysis to detect actual audio data flow
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        source.connect(analyser);
        
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // Monitor actual audio data flow
        const audioDataMonitor = setInterval(() => {
          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          const maxLevel = Math.max(...Array.from(dataArray));
          
          if (average > 0 || maxLevel > 0) {
            console.log(`🎵 Audio data detected from ${peerId}: avg=${Math.round(average)}, max=${maxLevel}`);
          } else {
            console.warn(`🔇 No audio data from ${peerId} (avg=${average}, max=${maxLevel}) - track may be silent or muted`);
          }
          
          // If we detect audio data but track appears muted, there might be a WebRTC issue
          if ((average > 0 || maxLevel > 0) && audioTracks[0]?.muted) {
            console.warn(`🚨 ANOMALY: Audio data detected but track is marked as muted for ${peerId}`);
          }
        }, 5000);
        
        // Clean up audio analysis when stream ends
        const originalRemove = audio.remove.bind(audio);
        audio.remove = () => {
          clearInterval(streamMonitor);
          clearInterval(audioDataMonitor);
          audioContext.close();
          originalRemove();
        };
        
      } catch (audioContextError) {
        console.warn(`⚠️ Could not create audio analysis for ${peerId}:`, audioContextError);
        
        // Fallback cleanup without audio context
        const originalRemove = audio.remove.bind(audio);
        audio.remove = () => {
          clearInterval(streamMonitor);
          originalRemove();
        };
      }
      
      // Make audio element visible for debugging if needed
      audio.style.position = 'fixed';
      audio.style.bottom = '10px';
      audio.style.right = '10px';
      audio.style.width = '200px';
      audio.style.height = '30px';
      audio.style.zIndex = '1000';
      audio.style.opacity = '0.1'; // Almost invisible but can be seen for debugging
      audio.style.pointerEvents = 'none';
      
      // Add to DOM first
      document.body.appendChild(audio);
      
      // Initialize audio playback
      initializeAudio();
      
      console.log(`🎧 Audio element created and configured for ${peerId}`);
      
    } catch (err) {
      console.error('❌ Error creating audio element:', err);
    }
  }
  
  private removeAudioElement(peerId: string) {
    const audioElement = document.getElementById(`voice-${peerId}`);
    if (audioElement) {
      audioElement.remove();
    }
  }

  private attemptTrackUnmute(peerId: string, track: MediaStreamTrack, stream: MediaStream) {
    console.log(`🔧 Attempting to fix muted track for ${peerId}...`);
    
    // Request user interaction to enable audio playback
    const enableAudioAfterInteraction = async () => {
      try {
        console.log(`🖱️ User interaction detected, attempting to enable audio for ${peerId}...`);
        
        // Force audio element settings
        track.enabled = true;
        
        console.log(`🎉 Audio enablement attempt completed for ${peerId}`);
        
        // Remove event listeners
        document.removeEventListener('click', enableAudioAfterInteraction);
        document.removeEventListener('keydown', enableAudioAfterInteraction);
        
      } catch (err) {
        console.error(`❌ Failed to enable audio after interaction for ${peerId}:`, err);
      }
    };
    
    // Set up user interaction listeners
    document.addEventListener('click', enableAudioAfterInteraction, { once: true });
    document.addEventListener('keydown', enableAudioAfterInteraction, { once: true });
    
    console.log(`💡 IMPORTANT: Click anywhere on the page to enable audio from ${peerId}`);
    console.log(`🔧 Note: Track muting is often caused by browser autoplay restrictions`);
  }
}

// Export a singleton instance
export const voiceChat = new VoiceChat();
export default voiceChat; 