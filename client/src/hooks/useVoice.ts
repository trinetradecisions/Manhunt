'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import {
  VoiceChannelId,
  VoiceParticipant,
  PeerVoiceState,
  VoiceDiagnostics,
} from '../types/game';
import { getIceConfiguration } from '../utils/networkConfig';

interface UseVoiceProps {
  socket: Socket | null;
  roomCode?: string;
  playerId?: string;
  myNickname?: string;
}

export function useVoice({ socket, roomCode, playerId, myNickname }: UseVoiceProps) {
  const [activeVoiceChannel, setActiveVoiceChannel] = useState<VoiceChannelId | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [speakingPlayerIds, setSpeakingPlayerIds] = useState<Set<string>>(new Set());
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [micPermission, setMicPermission] = useState<
    'prompt' | 'granted' | 'denied' | 'requesting'
  >('prompt');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);
  const [peerStates, setPeerStates] = useState<Record<string, PeerVoiceState>>({});

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const isTransmittingRef = useRef<boolean>(false);
  const activeChannelRef = useRef<VoiceChannelId | null>(null);

  // Perfect Negotiation tracking refs per peer
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  const ignoreOfferRef = useRef<Map<string, boolean>>(new Map());

  // Keep refs synchronized
  useEffect(() => {
    isTransmittingRef.current = isTransmitting;
  }, [isTransmitting]);

  useEffect(() => {
    activeChannelRef.current = activeVoiceChannel;
  }, [activeVoiceChannel]);

  // Tactical radio audio chirp synthesizer (Web Audio API)
  const playTacticalChirp = useCallback((type: 'start' | 'stop') => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      if (type === 'start') {
        // High-pitched PTT start beep (chirp-up: 1600Hz -> 2400Hz)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1600, now);
        osc.frequency.exponentialRampToValueAtTime(2400, now + 0.05);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
        osc.start(now);
        osc.stop(now + 0.07);
      } else {
        // Squelch release click (chirp-down: 900Hz -> 300Hz)
        osc.type = 'square';
        osc.frequency.setValueAtTime(900, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.04);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
      }
    } catch {
      // Audio feedback is non-critical
    }
  }, []);

  // Unlock audio playback after browser autoplay policy restriction
  const enableAudioPlayback = useCallback(async () => {
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume().catch(() => {});
    }
    for (const audio of audioElementsRef.current.values()) {
      try {
        await audio.play();
      } catch (err) {
        console.warn('[WebRTC] Audio play error on unlock gesture:', err);
      }
    }
    setAutoplayBlocked(false);
  }, []);

  // Clean up all peer connections & audio elements
  const cleanupConnections = useCallback(() => {
    for (const [, pc] of peerConnectionsRef.current.entries()) {
      try {
        pc.close();
      } catch {
        // Ignored
      }
    }
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    makingOfferRef.current.clear();
    ignoreOfferRef.current.clear();

    for (const [, audio] of audioElementsRef.current.entries()) {
      try {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
      } catch {
        // Ignored
      }
    }
    audioElementsRef.current.clear();
    setPeerStates({});
    setParticipants([]);
    setSpeakingPlayerIds(new Set());
    setAutoplayBlocked(false);
  }, []);

  // Stop transmitting (PTT released)
  const stopTransmitting = useCallback(() => {
    if (!isTransmittingRef.current) return;

    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
    }

    if (socket && roomCode && playerId && activeChannelRef.current) {
      socket.emit('voice:speaking', {
        roomCode,
        playerId,
        channelId: activeChannelRef.current,
        isSpeaking: false,
      });
    }

    playTacticalChirp('stop');
    setIsTransmitting(false);
    isTransmittingRef.current = false;
  }, [socket, roomCode, playerId, playTacticalChirp]);

  // Start transmitting (PTT pressed)
  const startTransmitting = useCallback(() => {
    if (isMuted || !activeChannelRef.current || isTransmittingRef.current) return;

    // Proactively unlock any autoplay-blocked remote audio on user interaction
    enableAudioPlayback();

    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
    }

    if (socket && roomCode && playerId && activeChannelRef.current) {
      socket.emit('voice:speaking', {
        roomCode,
        playerId,
        channelId: activeChannelRef.current,
        isSpeaking: true,
      });
    }

    playTacticalChirp('start');
    setIsTransmitting(true);
    isTransmittingRef.current = true;
  }, [isMuted, socket, roomCode, playerId, playTacticalChirp, enableAudioPlayback]);

  // Create Peer Connection with W3C Perfect Negotiation Pattern
  const setupPeerConnection = useCallback(
    (targetPlayerId: string, channelId: VoiceChannelId) => {
      if (!socket || !roomCode || !playerId) return null;

      // Close existing connection if any
      if (peerConnectionsRef.current.has(targetPlayerId)) {
        try {
          peerConnectionsRef.current.get(targetPlayerId)?.close();
        } catch {
          // Ignored
        }
        peerConnectionsRef.current.delete(targetPlayerId);
      }

      const isPolite = playerId > targetPlayerId;
      const pc = new RTCPeerConnection(getIceConfiguration());
      peerConnectionsRef.current.set(targetPlayerId, pc);
      makingOfferRef.current.set(targetPlayerId, false);
      ignoreOfferRef.current.set(targetPlayerId, false);

      // Add local audio track if available, or create audio transceiver to ensure bidirectional media description
      if (localStreamRef.current && localStreamRef.current.getAudioTracks().length > 0) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      } else {
        try {
          pc.addTransceiver('audio', { direction: 'sendrecv' });
        } catch {
          // Ignored
        }
      }

      const updatePeerDiagnostic = () => {
        setPeerStates((prev) => ({
          ...prev,
          [targetPlayerId]: {
            playerId: targetPlayerId,
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            iceGatheringState: pc.iceGatheringState,
            hasAudioTrack: !!audioElementsRef.current.get(targetPlayerId)?.srcObject,
          },
        }));
      };

      pc.onconnectionstatechange = updatePeerDiagnostic;
      pc.onicegatheringstatechange = updatePeerDiagnostic;
      pc.oniceconnectionstatechange = () => {
        updatePeerDiagnostic();
        if (pc.iceConnectionState === 'failed') {
          console.warn(`[WebRTC] ICE failed with peer ${targetPlayerId}. Attempting restart.`);
          try {
            pc.restartIce();
          } catch {
            // Ignored
          }
        }
      };

      // W3C Perfect Negotiation: onnegotiationneeded
      pc.onnegotiationneeded = async () => {
        try {
          makingOfferRef.current.set(targetPlayerId, true);
          await pc.setLocalDescription();
          if (socket.connected && roomCode && playerId) {
            socket.emit('voice:signal', {
              roomCode,
              senderId: playerId,
              targetPlayerId,
              channelId,
              signal: { description: pc.localDescription },
            });
          }
        } catch (err) {
          console.error(`[WebRTC] Negotiation error with ${targetPlayerId}:`, err);
        } finally {
          makingOfferRef.current.set(targetPlayerId, false);
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = ({ candidate }) => {
        if (candidate && socket.connected && roomCode && playerId) {
          socket.emit('voice:signal', {
            roomCode,
            senderId: playerId,
            targetPlayerId,
            channelId,
            signal: { candidate: candidate.toJSON ? candidate.toJSON() : candidate },
          });
        }
      };

      // Handle remote audio stream and attach to DOM
      pc.ontrack = (event) => {
        const stream =
          event.streams && event.streams[0]
            ? event.streams[0]
            : new MediaStream([event.track]);

        let audio = audioElementsRef.current.get(targetPlayerId);
        if (!audio) {
          audio = document.createElement('audio');
          audio.autoplay = true;
          (audio as any).playsInline = true;
          audio.muted = false;
          audio.volume = 1.0;
          // Avoid display: none which pauses playback in mobile and modern browsers
          audio.style.position = 'fixed';
          audio.style.top = '-9999px';
          audio.style.left = '-9999px';
          audio.style.width = '1px';
          audio.style.height = '1px';
          audio.style.opacity = '0.01';
          audio.style.pointerEvents = 'none';
          document.body.appendChild(audio);
          audioElementsRef.current.set(targetPlayerId, audio);
        }
        audio.srcObject = stream;
        updatePeerDiagnostic();

        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn(`[WebRTC] Autoplay blocked for ${targetPlayerId}:`, err);
            setAutoplayBlocked(true);
          });
        }
      };

      updatePeerDiagnostic();
      return pc;
    },
    [socket, roomCode, playerId]
  );

  // Join a voice channel
  const joinVoiceChannel = useCallback(
    async (channelId: VoiceChannelId) => {
      if (!socket || !roomCode || !playerId) {
        setVoiceError('Socket connection not ready. Please try again.');
        return;
      }

      setVoiceError(null);
      setMicPermission('requesting');

      // Verify browser mediaDevices support & Secure Context
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const isSecure =
          typeof window !== 'undefined' &&
          (window.isSecureContext ||
            window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1');

        setMicPermission('denied');
        const errorMsg = !isSecure
          ? 'Microphone requires a Secure Context (HTTPS or localhost). On mobile devices over LAN, please use HTTPS or Chrome flags.'
          : 'Microphone mediaDevices API is not supported on this browser.';
        setVoiceError(errorMsg);
        return;
      }

      try {
        // Request microphone access
        let stream = localStreamRef.current;
        if (!stream || stream.getAudioTracks().length === 0) {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          localStreamRef.current = stream;
        }

        // Keep audio track disabled by default until Push-to-Talk is held
        stream.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });

        setMicPermission('granted');
        enableAudioPlayback();

        // Leave existing channel/connections
        cleanupConnections();

        // Emit voice:join to server
        socket.emit(
          'voice:join',
          { roomCode, playerId, channelId },
          (res: { success: boolean; participants?: VoiceParticipant[]; error?: string }) => {
            if (res.success && res.participants) {
              setActiveVoiceChannel(channelId);
              setParticipants(res.participants);

              // Connect to all existing participants in channel
              res.participants.forEach((part) => {
                setupPeerConnection(part.playerId, channelId);
              });
            } else {
              setVoiceError(res.error || 'Failed to join voice channel');
            }
          }
        );
      } catch (err: any) {
        setMicPermission('denied');
        setVoiceError(
          err.name === 'NotAllowedError'
            ? 'Microphone permission denied. Please allow microphone access.'
            : err.message || 'Failed to access microphone'
        );
      }
    },
    [socket, roomCode, playerId, cleanupConnections, setupPeerConnection]
  );

  // Leave active voice channel
  const leaveVoiceChannel = useCallback(() => {
    stopTransmitting();

    if (socket && roomCode && playerId) {
      socket.emit('voice:leave', { roomCode, playerId });
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    cleanupConnections();
    setActiveVoiceChannel(null);
  }, [stopTransmitting, socket, roomCode, playerId, cleanupConnections]);

  // Set up socket signaling listeners
  useEffect(() => {
    if (!socket) return;

    // A new user joined the voice channel
    const handleUserJoined = (participant: VoiceParticipant) => {
      setParticipants((prev) => {
        if (prev.some((p) => p.playerId === participant.playerId)) return prev;
        return [...prev, participant];
      });

      const currentChan = activeChannelRef.current;
      if (currentChan) {
        setupPeerConnection(participant.playerId, currentChan);
      }
    };

    // A user left the voice channel
    const handleUserLeft = ({ playerId: leftId }: { playerId: string; channelId: string }) => {
      setParticipants((prev) => prev.filter((p) => p.playerId !== leftId));
      setSpeakingPlayerIds((prev) => {
        const next = new Set(prev);
        next.delete(leftId);
        return next;
      });

      if (peerConnectionsRef.current.has(leftId)) {
        try {
          peerConnectionsRef.current.get(leftId)?.close();
        } catch {
          // Ignored
        }
        peerConnectionsRef.current.delete(leftId);
      }

      if (audioElementsRef.current.has(leftId)) {
        const audio = audioElementsRef.current.get(leftId);
        try {
          audio?.pause();
          audio?.remove();
        } catch {
          // Ignored
        }
        audioElementsRef.current.delete(leftId);
      }

      setPeerStates((prev) => {
        const next = { ...prev };
        delete next[leftId];
        return next;
      });
    };

    // Speaking indicator status changed
    const handleSpeakingChanged = ({
      playerId: speakerId,
      isSpeaking: speaking,
    }: {
      playerId: string;
      channelId: string;
      isSpeaking: boolean;
    }) => {
      setSpeakingPlayerIds((prev) => {
        const next = new Set(prev);
        if (speaking) {
          next.add(speakerId);
        } else {
          next.delete(speakerId);
        }
        return next;
      });
    };

    // Incoming WebRTC peer signal (offer, answer, ICE candidate) with Perfect Negotiation
    const handleVoiceSignal = async (payload: any) => {
      const senderId = payload.senderId || payload.fromPlayerId;
      const targetPlayerId = payload.targetPlayerId || payload.toPlayerId;
      const sigChannel = payload.channelId;
      const signal = payload.signal;

      if (!senderId || senderId === playerId) return;
      if (targetPlayerId && targetPlayerId !== playerId) return;

      const currentChan = activeChannelRef.current;
      if (sigChannel && sigChannel !== currentChan) return;

      let pc = peerConnectionsRef.current.get(senderId);
      if (!pc) {
        pc = setupPeerConnection(senderId, (sigChannel || currentChan || 'SQUAD') as VoiceChannelId) || undefined;
      }
      if (!pc) return;

      const isPolite = (playerId || '') > senderId;

      try {
        if (signal.description) {
          const desc = signal.description;
          const isStable = pc.signalingState === 'stable';
          const isOffer = desc.type === 'offer';
          const makingOffer = makingOfferRef.current.get(senderId) || false;
          const offerCollision = isOffer && (makingOffer || !isStable);

          const shouldIgnore = !isPolite && offerCollision;
          ignoreOfferRef.current.set(senderId, shouldIgnore);
          if (shouldIgnore) {
            console.log(`[WebRTC] Collision: Impolite peer ignoring offer from ${senderId}`);
            return;
          }

          if (offerCollision && isPolite) {
            console.log(`[WebRTC] Collision: Polite peer rolling back for ${senderId}`);
            await pc.setLocalDescription({ type: 'rollback' });
          }

          await pc.setRemoteDescription(new RTCSessionDescription(desc));

          // Flush any buffered candidates received before remoteDescription was applied
          const pending = pendingCandidatesRef.current.get(senderId) || [];
          for (const cand of pending) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (candErr) {
              console.warn('[WebRTC] Buffered candidate error:', candErr);
            }
          }
          pendingCandidatesRef.current.delete(senderId);

          if (isOffer) {
            await pc.setLocalDescription();
            if (socket.connected && roomCode && playerId) {
              socket.emit('voice:signal', {
                roomCode,
                senderId: playerId,
                targetPlayerId: senderId,
                channelId: sigChannel || currentChan || 'SQUAD',
                signal: { description: pc.localDescription },
              });
            }
          }
        } else if (signal.candidate) {
          if (!pc.remoteDescription) {
            const queue = pendingCandidatesRef.current.get(senderId) || [];
            queue.push(signal.candidate);
            pendingCandidatesRef.current.set(senderId, queue);
          } else {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            } catch (candErr) {
              if (!ignoreOfferRef.current.get(senderId)) {
                console.warn('[WebRTC] Candidate application error:', candErr);
              }
            }
          }
        }
      } catch (err) {
        console.error(`[WebRTC] Error handling signal from ${senderId}:`, err);
      }
    };

    // Periodic synchronization of active voice participants
    const handleParticipantsSync = (synced: VoiceParticipant[]) => {
      const currentChan = activeChannelRef.current;
      if (!currentChan) return;

      const inChannel = synced.filter((p) => p.channelId === currentChan && p.playerId !== playerId);
      setParticipants(inChannel);

      inChannel.forEach((p) => {
        if (!peerConnectionsRef.current.has(p.playerId)) {
          setupPeerConnection(p.playerId, currentChan);
        }
      });

      setSpeakingPlayerIds((prev) => {
        const next = new Set(prev);
        inChannel.forEach((p) => {
          if (p.isSpeaking) next.add(p.playerId);
          else next.delete(p.playerId);
        });
        return next;
      });
    };

    socket.on('voice:user_joined', handleUserJoined);
    socket.on('voice:user_left', handleUserLeft);
    socket.on('voice:speaking_changed', handleSpeakingChanged);
    socket.on('voice:signal', handleVoiceSignal);
    socket.on('voice:participants_sync', handleParticipantsSync);

    return () => {
      socket.off('voice:user_joined', handleUserJoined);
      socket.off('voice:user_left', handleUserLeft);
      socket.off('voice:speaking_changed', handleSpeakingChanged);
      socket.off('voice:signal', handleVoiceSignal);
      socket.off('voice:participants_sync', handleParticipantsSync);
    };
  }, [socket, setupPeerConnection, roomCode, playerId]);

  // Safety listeners to prevent stuck microphone on lost focus or interruption
  useEffect(() => {
    const handleSafetyRelease = () => {
      stopTransmitting();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Key "V" or "Space" (when not typing in an input) for PTT
      if (
        e.code === 'KeyV' &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        if (!e.repeat) {
          startTransmitting();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (
        e.code === 'KeyV' &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        stopTransmitting();
      }
    };

    window.addEventListener('blur', handleSafetyRelease);
    window.addEventListener('pointerup', handleSafetyRelease);
    window.addEventListener('touchend', handleSafetyRelease);
    window.addEventListener('touchcancel', handleSafetyRelease);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('blur', handleSafetyRelease);
      window.removeEventListener('pointerup', handleSafetyRelease);
      window.removeEventListener('touchend', handleSafetyRelease);
      window.removeEventListener('touchcancel', handleSafetyRelease);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [startTransmitting, stopTransmitting]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      leaveVoiceChannel();
    };
  }, [leaveVoiceChannel]);

  // Compute aggregate voice diagnostics
  const connectedPeerCount = Object.values(peerStates).filter(
    (p) => p.connectionState === 'connected' || p.iceConnectionState === 'connected'
  ).length;

  const isNegotiating = Object.values(peerStates).some(
    (p) => p.connectionState === 'connecting' || p.iceConnectionState === 'checking'
  );

  let diagnosticsStatus: VoiceDiagnostics['status'] = 'DISCONNECTED';
  if (activeVoiceChannel) {
    if (participants.length === 0) {
      diagnosticsStatus = 'WAITING_PEERS';
    } else if (connectedPeerCount > 0) {
      diagnosticsStatus = 'CONNECTED';
    } else if (isNegotiating) {
      diagnosticsStatus = 'NEGOTIATING';
    } else {
      diagnosticsStatus = 'JOINING';
    }
  }

  const diagnostics: VoiceDiagnostics = {
    status: diagnosticsStatus,
    selectedChannel: activeVoiceChannel,
    micPermission,
    hasMicStream: !!localStreamRef.current,
    authorizedPeerCount: participants.length,
    connectedPeerCount,
    peerStates,
    autoplayBlocked,
    lastError: voiceError,
  };

  return {
    activeVoiceChannel,
    participants,
    speakingPlayerIds,
    isTransmitting,
    isMuted,
    micPermission,
    voiceError,
    autoplayBlocked,
    enableAudioPlayback,
    diagnostics,
    joinVoiceChannel,
    leaveVoiceChannel,
    startTransmitting,
    stopTransmitting,
    toggleMute: () => setIsMuted((prev) => !prev),
  };
}
