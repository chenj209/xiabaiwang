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
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error("getUserMedia is not supported in this browser");
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
    } catch (err) {
      console.error("Failed to get user media:", err);
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
      
      // Create PeerJS instance with minimal configuration for better performance
      this.myPeer = new Peer(peerId, {
        config: {
          iceServers: [
            { urls: 'stun:stun.miwifi.com:3478' },
            { urls: 'stun:stun.chat.bilibili.com:3478' },
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
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
            
            call.on('stream', (remoteStream) => {
              this.createAudioElement(call.peer, remoteStream);
            });
            
            call.on('close', () => {
              this.removeAudioElement(call.peer);
            });
            
            call.on('error', () => {
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
    try {
      if (!this.myPeer || !this.localStream) return;
      
      const call = this.myPeer.call(peerId, this.localStream);
      
      // Handle stream from the called peer
      call.on('stream', (remoteStream) => {
        this.createAudioElement(peerId, remoteStream);
      });
      
      // Handle call close
      call.on('close', () => {
        this.removeAudioElement(peerId);
      });
      
      // Handle call errors
      call.on('error', (err) => {
        if (retryCount < 2) {
          // Retry with exponential backoff
          setTimeout(() => this.callPeer(peerId, retryCount + 1), 1000 * Math.pow(2, retryCount));
        } else {
          this.removeAudioElement(peerId);
        }
      });
      
      // Store the call
      this.connections.set(peerId, call);
      
    } catch (err) {
      if (retryCount < 2) {
        // Retry with exponential backoff
        setTimeout(() => this.callPeer(peerId, retryCount + 1), 1000 * Math.pow(2, retryCount));
      }
    }
  }

  private createAudioElement(peerId: string, stream: MediaStream) {
    // Remove existing audio element if any
    this.removeAudioElement(peerId);
    
    try {
      // Create optimized audio element
      const audio = document.createElement('audio');
      audio.id = `voice-${peerId}`;
      audio.srcObject = stream;
      audio.autoplay = true;
      
      // Add additional attributes for better performance
      audio.setAttribute('playsinline', '');
      audio.muted = false;
      
      // Hide the audio element
      audio.style.display = 'none';
      
      // Add to DOM
      document.body.appendChild(audio);
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