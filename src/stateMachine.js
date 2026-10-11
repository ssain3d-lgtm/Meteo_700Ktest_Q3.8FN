// Skill phase state machine: IDLE -> SUMMON -> CHARGE -> SKY_WARNING -> DESCENT -> IMPACT -> AFTERMATH -> DISSIPATE -> IDLE
export const PHASES = ['IDLE', 'SUMMON', 'CHARGE', 'SKY_WARNING', 'DESCENT', 'IMPACT', 'AFTERMATH', 'DISSIPATE'];

// Auto-advance durations for the FULL DEMO run (DESCENT is driven by the meteor itself).
const DURATIONS = {
  IDLE: Infinity,
  SUMMON: 2.6,
  CHARGE: 3.0,
  SKY_WARNING: 2.4,
  DESCENT: Infinity, // ends when the meteor hits the ground
  IMPACT: 1.6,
  AFTERMATH: 9.0,
  DISSIPATE: 5.0
};

const NEXT = {
  IDLE: 'SUMMON',
  SUMMON: 'CHARGE',
  CHARGE: 'SKY_WARNING',
  SKY_WARNING: 'DESCENT',
  DESCENT: 'IMPACT',
  IMPACT: 'AFTERMATH',
  AFTERMATH: 'DISSIPATE',
  DISSIPATE: 'IDLE'
};

export class StateMachine {
  constructor() {
    this.phase = 'IDLE';
    this.timeInPhase = 0;
    this.totalTime = 0;
    this.auto = false;      // true while FULL DEMO is running
    this.listeners = [];
    this.phaseRequested = null; // set by external triggers (e.g. meteor landing)
  }

  onPhaseChange(fn) { this.listeners.push(fn); }

  setPhase(name) {
    if (!PHASES.includes(name)) return;
    const prev = this.phase;
    if (prev === name) return;
    this.phase = name;
    this.timeInPhase = 0;
    this.phaseRequested = null;
    for (const fn of this.listeners) fn(name, prev);
  }

  next() {
    this.setPhase(NEXT[this.phase]);
  }

  requestNext() {
    this.phaseRequested = NEXT[this.phase];
  }

  startDemo() {
    this.auto = true;
    if (this.phase !== 'IDLE') this.setPhase('IDLE');
    this.setPhase('SUMMON');
  }

  reset() {
    this.auto = false;
    this.setPhase('IDLE');
  }

  update(dt) {
    this.timeInPhase += dt;
    this.totalTime += dt;
    if (this.phaseRequested) {
      const target = this.phaseRequested;
      this.phaseRequested = null;
      this.setPhase(target);
      return;
    }
    if (!this.auto) return;
    const dur = DURATIONS[this.phase];
    if (this.timeInPhase >= dur) this.next();
  }
}

export function phaseDuration(name) {
  return DURATIONS[name] ?? 0;
}
