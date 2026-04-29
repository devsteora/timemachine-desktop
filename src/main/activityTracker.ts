import { uIOhook } from 'uiohook-napi';

let keyTimestamps: number[] = [];
let mouseMovements: { x: number, y: number, time: number }[] = [];
const THRESHOLD = 40;

export function startTracking() {
  uIOhook.on('keydown', () => {
    keyTimestamps.push(Date.now());
  });

  uIOhook.on('mousemove', (e) => {
    mouseMovements.push({ x: e.x, y: e.y, time: Date.now() });
  });

  uIOhook.start();
  console.log('uIOhook Anti-Cheat Engine started.');
}

function calculateKeyboardVariance(timestamps: number[]): number {
  if (timestamps.length < 2) return 0;
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }
  
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length;
  return Math.min(variance / 1000, 100); 
}

function calculateMouseEntropy(movements: any[]): number {
  if (movements.length < 2) return 0;
  let linearPatterns = 0;

  for (let i = 1; i < movements.length; i++) {
    const dx = movements[i].x - movements[i-1].x;
    const dy = movements[i].y - movements[i-1].y;
    if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) {
      linearPatterns++;
    }
  }
  const entropyScore = 100 - ((linearPatterns / movements.length) * 100);
  return Math.max(entropyScore, 0); 
}

export function evaluateActivityMinute() {
  const kbVariance = calculateKeyboardVariance(keyTimestamps);
  const mouseEntropy = calculateMouseEntropy(mouseMovements);
  const intFreq = Math.min((keyTimestamps.length + mouseMovements.length) / 100, 100);

  const activityScore = (kbVariance * 0.4) + (mouseEntropy * 0.3) + (intFreq * 0.3);
  
  let status = 'ACTIVE';
  if (activityScore < THRESHOLD && intFreq > 0) status = 'SUSPICIOUS';
  if (intFreq === 0) status = 'IDLE';

  keyTimestamps = [];
  mouseMovements = [];

  return { activityScore, status, kbVariance, mouseEntropy };
}