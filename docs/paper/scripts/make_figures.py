import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import os

OUT = '/home/cgodwin/code/atlas-harness/docs/paper/figures'
os.makedirs(OUT, exist_ok=True)

RUN = '/home/cgodwin/bench-runs/corr-g244-run2-20260825071455'

# Load per-task waste-ratio per arm from run.log
ev = []
for line in open(f'{RUN}/run.log'):
    line = line.strip()
    if not line:
        continue
    try:
        d = json.loads(line)
    except Exception:
        continue
    if d.get('event') == 'session':
        ev.append(d)
arm = {}
for d in ev:
    arm.setdefault(d['arm'], {})[d['taskId']] = d

tasks = sorted(set(arm['clone']) & set(arm['additive']))
# paired waste delta: clone - additive (>0 => additive wastes less)
deltas = [(t, arm['clone'][t].get('wasteRatio', 0) - arm['additive'][t].get('wasteRatio', 0))
          for t in tasks]
deltas.sort(key=lambda x: x[1])

tasks_names = [t for t, _ in deltas]
vals = [v for _, v in deltas]
colors = ['#1a7f37' if v > 0 else ('#8a8f98' if v == 0 else '#d64545') for v in vals]

fig, ax = plt.subplots(figsize=(10, 5.4))
ax.bar(np.arange(len(tasks_names)), vals, color=colors, edgecolor='none')
ax.axhline(0, color='black', linewidth=0.8)
n_pos = sum(1 for v in vals if v > 0)   # Atlas wastes less
n_neg = sum(1 for v in vals if v < 0)   # Atlas wastes more
n_eq = sum(1 for v in vals if v == 0)
ax.set_xlabel('Task (sorted by paired waste delta, clone − Atlas)')
ax.set_ylabel('Waste-ratio delta (clone − Atlas)')
ax.set_title(f'Per-task waste-ratio delta — effect spans the suite '
             f'(Atlas lower on {n_pos}, higher on {n_neg}, tie {n_eq})')
ax.set_xticks(range(0, len(tasks_names), 6))
ax.set_xticklabels([tasks_names[i] for i in range(0, len(tasks_names), 6)], rotation=45, ha='right', fontsize=7)
# legend patches
from matplotlib.patches import Patch
legend = [Patch(color='#1a7f37', label='Atlas lower waste'),
          Patch(color='#d64545', label='Atlas higher waste'),
          Patch(color='#8a8f98', label='Tie')]
ax.legend(handles=legend, fontsize=9, loc='upper left')
plt.tight_layout()
out_png = f'{OUT}/fig-waste-spread.png'
plt.savefig(out_png, dpi=150)
plt.close()
print('fig-waste-spread.png', os.path.getsize(out_png), 'bytes')

# Clean obsolete figures from the removed Study A/B framing
for stale in ['fig-pool-decomposition.png', 'fig-per-task-billed.png']:
    p = f'{OUT}/{stale}'
    if os.path.exists(p):
        os.remove(p)
        print('removed stale', stale)