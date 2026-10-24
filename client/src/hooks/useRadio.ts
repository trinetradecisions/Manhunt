'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { RadioTransmission } from '../types/game';
import { getBackendUrl } from '../utils/networkConfig';

interface UseRadioProps {
  roomCode?: string;
  senderId?: string;
}

export type RadioRecordingState =
  | 'idle'
  | 'recording'
  | 'reviewing'
  | 'uploading'
  | 'success'
  | 'error';

export function useRadio({ roomCode, senderId }: UseRadioProps) {
  const [recordingState, setRecordingState] = useState<RadioRecordingState>('idle');
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [isPlayingIncoming, setIsPlayingIncoming] = useState(false);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordStartTimeRef = useRef<number>(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const recordedBlobRef = useRef<Blob | null>(null);

  const startRecording = useCallback(async () => {
    setAudioError(null);
    audioChunksRef.current = [];
    setRecordingElapsedSeconds(0);
    setPreviewAudioUrl(null);
    recordedBlobRef.current = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const duration = Date.now() - recordStartTimeRef.current;
        setRecordedDurationMs(duration);

        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        recordedBlobRef.current = audioBlob;

        // Create local object URL for pre-send review
        const localUrl = URL.createObjectURL(audioBlob);
        setPreviewAudioUrl(localUrl);
        setRecordingState('reviewing');

        // Stop all mic tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current = recorder;
      recordStartTimeRef.current = Date.now();
      recorder.start();
      setRecordingState('recording');

      // 1-second elapsed counter
      timerIntervalRef.current = setInterval(() => {
        setRecordingElapsedSeconds((prev) => {
          if (prev >= 15) {
            stopRecording();
            return 15;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err: any) {
      setRecordingState('error');
      setAudioError(
        err.name === 'NotAllowedError'
          ? 'Microphone permission denied. Please allow microphone access.'
          : err.message || 'Failed to access microphone'
      );
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const cancelRecording = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }

    if (previewAudioUrl) {
      URL.revokeObjectURL(previewAudioUrl);
    }

    if (previewAudioElementRef.current) {
      previewAudioElementRef.current.pause();
    }

    recordedBlobRef.current = null;
    setPreviewAudioUrl(null);
    setRecordingState('idle');
    setRecordingElapsedSeconds(0);
    setIsPlayingPreview(false);
  }, [previewAudioUrl]);

  const sendRecording = useCallback(async () => {
    if (!recordedBlobRef.current || !roomCode || !senderId) {
      setAudioError('Missing recording data or player session.');
      return;
    }

    setRecordingState('uploading');
    setAudioError(null);

    const formData = new FormData();
    formData.append('audio', recordedBlobRef.current, 'radio_message.webm');
    formData.append('roomCode', roomCode);
    formData.append('senderId', senderId);
    formData.append('durationMs', recordedDurationMs.toString());

    const serverUrl = getBackendUrl();

    try {
      const res = await fetch(`${serverUrl}/api/radio/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json();
        setRecordingState('error');
        setAudioError(errData.error || 'Failed to transmit audio');
        return;
      }

      setRecordingState('success');
      setTimeout(() => {
        cancelRecording();
      }, 1500);
    } catch (err: any) {
      setRecordingState('error');
      setAudioError(err.message || 'Radio transmission network error');
    }
  }, [roomCode, senderId, recordedDurationMs, cancelRecording]);

  const playPreviewAudio = useCallback(() => {
    if (!previewAudioUrl) return;

    if (previewAudioElementRef.current) {
      previewAudioElementRef.current.pause();
    }

    const audio = new Audio(previewAudioUrl);
    previewAudioElementRef.current = audio;

    audio.onplay = () => setIsPlayingPreview(true);
    audio.onended = () => setIsPlayingPreview(false);
    audio.onerror = () => {
      setIsPlayingPreview(false);
      setAudioError('Error playing preview');
    };

    audio.play().catch(() => setIsPlayingPreview(false));
  }, [previewAudioUrl]);

  const stopPreviewAudio = useCallback(() => {
    if (previewAudioElementRef.current) {
      previewAudioElementRef.current.pause();
      setIsPlayingPreview(false);
    }
  }, []);

  const playIncomingRadio = useCallback(
    (transmission: RadioTransmission, onEnded?: () => void) => {
      const serverUrl = getBackendUrl();
      const fullUrl = `${serverUrl}${transmission.audioUrl}`;

      if (currentAudioElementRef.current) {
        currentAudioElementRef.current.pause();
      }

      const audio = new Audio(fullUrl);
      currentAudioElementRef.current = audio;

      audio.onplay = () => setIsPlayingIncoming(true);
      audio.onended = () => {
        setIsPlayingIncoming(false);
        if (onEnded) onEnded();
      };
      audio.onerror = () => {
        setIsPlayingIncoming(false);
        setAudioError('Failed to playback incoming radio message (may be expired)');
      };

      audio.play().catch(() => {
        setAudioError('Audio blocked by browser. Tap screen to listen.');
      });
    },
    []
  );

  const triggerVibration = useCallback(() => {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate([150, 80, 150, 80, 150]);
      } catch (e) {
        // Ignored if device doesn't support
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl);
    };
  }, [previewAudioUrl]);

  return {
    recordingState,
    recordingElapsedSeconds,
    recordedDurationMs,
    previewAudioUrl,
    isPlayingIncoming,
    isPlayingPreview,
    audioError,
    startRecording,
    stopRecording,
    cancelRecording,
    sendRecording,
    playPreviewAudio,
    stopPreviewAudio,
    playIncomingRadio,
    triggerVibration,
  };
}
