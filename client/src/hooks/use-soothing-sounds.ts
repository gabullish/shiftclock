import { useEffect, useRef } from 'react';

export const useSoothingSounds = () => {
  const ctx = useRef<AudioContext | null>(null);

  const getCtx = () => {
    if (!ctx.current) {
      ctx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    // Browsers start the context "suspended" until a user gesture and may
    // auto-suspend it later. Resume so sounds triggered outside a direct click
    // (e.g. the break-start beep fired from a setTimeout) aren't silently dropped.
    if (ctx.current.state === 'suspended') {
      void ctx.current.resume();
    }
    return ctx.current;
  };

  // Release the AudioContext on unmount — browsers cap concurrent contexts (~6),
  // and each page mounting this hook would otherwise leak one until page reload.
  useEffect(() => {
    return () => {
      const c = ctx.current;
      ctx.current = null;
      if (c && c.state !== 'closed') void c.close();
    };
  }, []);

  const playSoftClick = () => {
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.frequency.setValueAtTime(680, c.currentTime);
    gain.gain.setValueAtTime(0.3, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.12);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.15);
  };

  const playDragWhoosh = () => {
    const c = getCtx();
    const noise = c.createBufferSource();
    const buffer = c.createBuffer(1, c.sampleRate * 0.4, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < buffer.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, c.currentTime);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.15, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.4);
    noise.connect(filter).connect(gain).connect(c.destination);
    noise.start();
  };

  const playSuccess = () => {
    const c = getCtx();
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(520, c.currentTime);
    osc.frequency.setValueAtTime(680, c.currentTime + 0.08);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.25, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.35);
  };

  const playBreakStart = () => {
    const c = getCtx();
    [{ f: 420, t: 0 }, { f: 340, t: 0.2 }].forEach(({ f, t }) => {
      const osc = c.createOscillator(); osc.frequency.value = f;
      const g   = c.createGain();       g.gain.setValueAtTime(0.13, c.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t + 0.28);
      osc.connect(g).connect(c.destination);
      osc.start(c.currentTime + t); osc.stop(c.currentTime + t + 0.32);
    });
  };

  return { playSoftClick, playDragWhoosh, playSuccess, playBreakStart };
};
