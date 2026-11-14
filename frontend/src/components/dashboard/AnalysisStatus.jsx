import React from 'react';

const dotClass = (state) => {
  if (state === 'online' || state === 'ready') return 'status-dot';
  if (state === 'loading') return 'status-dot status-dot--loading';
  if (state === 'offline' || state === 'error') return 'status-dot status-dot--off';
  return 'status-dot status-dot--muted';
};

const AnalysisStatus = ({ weatherLoading, habitabilityLoading, analysis, habitability, systemStatus, healthLoading }) => {
  const running = weatherLoading || habitabilityLoading;
  let label = 'Idle';
  let state = 'unknown';
  if (running) {
    label = 'Analysis running';
    state = 'loading';
  } else if (analysis || habitability) {
    label = 'Results available';
    state = 'ready';
  } else if (systemStatus?.backend === 'offline') {
    label = 'Backend unavailable';
    state = 'offline';
  }

  return (
    <div className="analysis-status">
      <span className={dotClass(state)} />
      <span>{healthLoading ? 'Checking services…' : label}</span>
    </div>
  );
};

export default AnalysisStatus;
