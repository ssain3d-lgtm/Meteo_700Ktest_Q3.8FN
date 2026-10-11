// UI wiring: phase buttons, sliders, sound toggle, phase readout.
const SLIDERS = [
  { key: 'glow', label: 'Glow', min: 0, max: 2, step: 0.01, initial: 1 },
  { key: 'particleCount', label: 'Particle Count', min: 0.2, max: 2, step: 0.01, initial: 1 },
  { key: 'meteorSize', label: 'Meteor Size', min: 0.5, max: 2.5, step: 0.01, initial: 1 },
  { key: 'descentSpeed', label: 'Descent Speed', min: 0.4, max: 2.2, step: 0.01, initial: 1 },
  { key: 'impactStrength', label: 'Impact Strength', min: 0.4, max: 1.8, step: 0.01, initial: 1 },
  { key: 'lavaIntensity', label: 'Lava Intensity', min: 0, max: 1.6, step: 0.01, initial: 1 },
  { key: 'heatDistortion', label: 'Heat Distortion', min: 0, max: 2, step: 0.01, initial: 1 },
  { key: 'shakeStrength', label: 'Shake Strength', min: 0, max: 2, step: 0.01, initial: 1 },
  { key: 'masterVolume', label: 'Master Volume', min: 0, max: 1, step: 0.01, initial: 0.8 }
];

export function createUI({ params, sm, audio, postfx, onReset }) {
  const root = document.getElementById('ui');
  const phaseEl = document.getElementById('phase');
  const phaseBar = document.getElementById('phasebar');

  const buttons = {
    summon: document.getElementById('btn-summon'),
    charge: document.getElementById('btn-charge'),
    warning: document.getElementById('btn-warning'),
    cast: document.getElementById('btn-cast'),
    demo: document.getElementById('btn-demo'),
    reset: document.getElementById('btn-reset'),
    sound: document.getElementById('btn-sound')
  };

  const sliderEls = {};
  const sliderWrap = document.getElementById('sliders');
  for (const s of SLIDERS) {
    const row = document.createElement('label');
    row.className = 'slider';
    const name = document.createElement('span');
    name.textContent = s.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = s.min;
    input.max = s.max;
    input.step = s.step;
    input.value = s.initial;
    const val = document.createElement('em');
    val.textContent = Number(s.initial).toFixed(2);
    row.append(name, input, val);
    sliderWrap.append(row);
    sliderEls[s.key] = { input, val };
    params[s.key] = s.initial;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      params[s.key] = v;
      val.textContent = v.toFixed(2);
      if (s.key === 'glow') postfx.setGlow(v);
      if (s.key === 'masterVolume') audio.setMasterVolume(v);
    });
  }

  buttons.summon.addEventListener('click', () => { audio.unlock(); sm.auto = false; sm.setPhase('SUMMON'); });
  buttons.charge.addEventListener('click', () => {
    audio.unlock();
    sm.auto = false;
    sm.setPhase(sm.phase === 'IDLE' ? 'SUMMON' : 'CHARGE');
  });
  buttons.warning.addEventListener('click', () => {
    audio.unlock();
    sm.auto = false;
    sm.setPhase('SKY_WARNING');
  });
  buttons.cast.addEventListener('click', () => {
    audio.unlock();
    sm.auto = false;
    if (sm.phase === 'DESCENT' || sm.phase === 'IMPACT') return;
    sm.setPhase('DESCENT');
  });
  buttons.demo.addEventListener('click', () => {
    audio.unlock();
    sm.startDemo();
  });
  buttons.reset.addEventListener('click', () => {
    sm.reset();
    onReset();
  });

  let soundOn = true;
  buttons.sound.addEventListener('click', () => {
    soundOn = !soundOn;
    audio.setEnabled(soundOn);
    buttons.sound.textContent = soundOn ? 'Sound: ON' : 'Sound: OFF';
    buttons.sound.classList.toggle('off', !soundOn);
  });

  let lastPhase = '';
  function refresh() {
    if (sm.phase !== lastPhase) {
      lastPhase = sm.phase;
      phaseEl.textContent = sm.phase;
      const idx = ['IDLE', 'SUMMON', 'CHARGE', 'SKY_WARNING', 'DESCENT', 'IMPACT', 'AFTERMATH', 'DISSIPATE'].indexOf(sm.phase);
      phaseBar.style.setProperty('--i', idx);
    }
  }

  return { refresh, setSound(on) { soundOn = on; } };
}
