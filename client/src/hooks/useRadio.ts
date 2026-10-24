'use client';

import { useState, useRef, useCallback } from 'react';
import { RadioTransmission } from '../types/game';

interface UseRadioProps {
  roomCode?: string;
  senderId?: string;
}

export function useRadio({ roomCode, senderId }: UseRadioProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordStartTimeRef = useRef<number>(0);
  const currentAudioElementRef = useRef<HTMLAudioElement | null>(null);

  const startRecording = useCallback(async () => {
    setAudioError(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const durationMs = Date.now() - recordStartTimeRef.current;
        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });

        // Release microphone tracks
        stream.getTracks().forEach((track) => track.stop());

        if (audioBlob.size > 0 && roomCode && senderId) {
          const formData = new FormData();
          formData.append('audio', audioBlob, 'radio_message.webm');
          formData.append('roomCode', roomCode);
          formData.append('senderId', senderId);
          formData.append('durationMs', durationMs.toString());

          const serverUrl =
            process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';

          try {
            const res = await fetch(`${serverUrl}/api/radio/upload`, {
              method: 'POST',
              body: formData,
            });
            if (!res.ok) {
              const errData = await res.json();
              setAudioError(errData.error || 'Failed to transmit audio');
            }
          } catch (err: any) {
            setAudioError(err.message || 'Radio transmission network error');
          }
        }
      };

      mediaRecorderRef.current = recorder;
      recordStartTimeRef.current = Date.now();
      recorder.start();
      setIsRecording(true);

      // Max 15 seconds cutoff
      setTimeout(() => {
        if (recorder.state === 'recording') {
          stopRecording();
        }
      }, 15000);
    } catch (err: any) {
      setAudioError(
        err.name === 'NotAllowedError'
          ? 'Microphone access denied. Enable permissions in browser.'
          : err.message
      );
    }
  }, [roomCode, senderId]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  const playIncomingRadio = useCallback(
    (transmission: RadioTransmission, onEnded?: () => void) => {
      const serverUrl =
        process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';
      const fullUrl = `${serverUrl}${transmission.audioUrl}`;

      if (currentAudioElementRef.current) {
        currentAudioElementRef.current.pause();
      }

      const audio = new Audio(fullUrl);
      currentAudioElementRef.current = audio;

      audio.onplay = () => setIsPlaying(true);
      audio.onended = () => {
        setIsPlaying(false);
        if (onEnded) onEnded();
      };
      audio.onerror = () => {
        setIsPlaying(false);
        setAudioError('Failed to playback incoming radio transmission');
      };

      audio.play().catch((err) => {
        setAudioError('Auto-play blocked. Tap screen to allow audio playback.');
      });
    },
    []
  );

  const triggerVibration = useCallback(() => {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate([150, 80, 150, 80, 150]);
      } catch (e) {
        // Ignored if device blocks background vibration
      }
    }
  }, []);

  return {
    isRecording,
    isPlaying,
    audioError,
    startRecording,
    stopRecording,
    playIncomingRadio,
    triggerVibration,
  };
}
