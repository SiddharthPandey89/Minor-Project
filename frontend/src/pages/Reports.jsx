import React from 'react';
import { useAppStore } from '../app/store.jsx';
import { selectors } from '../app/store.jsx';
import ReportGenerator from '../components/ai/ReportGenerator.jsx';
import AIChat from '../components/ai/AIChat.jsx';
import Card from '../components/common/Card.jsx';
import EmptyState from '../components/common/EmptyState.jsx';

const Reports = () => {
  const { state } = useAppStore();
  const analysis = selectors.analysis(state);
  const habitability = selectors.habitability(state);

  const context = {
    region: habitability?.region || analysis?.region || null,
    weather: analysis
      ? {
          status: 'available',
          data: analysis.analysis || analysis,
          provider: analysis.dataProvider || 'Open-Meteo',
          retrievedAt: analysis.retrievedAt || null,
        }
      : null,
    soil: habitability?.availableIndicators?.soilQuality || null,
    vegetation: habitability?.availableIndicators?.vegetation || null,
    habitability: habitability || null,
  };

  const hasData = Boolean(
    context.weather || context.soil || context.vegetation || context.habitability,
  );

  return (
    <div className="app-shell">
      <main className="page-container">
        <section className="page-intro">
          <div>
            <p className="eyebrow">TERRAXX / REPORTS</p>
            <h1>Reports</h1>
            <p className="intro-copy">
              Generate a text report from your latest analysis data, or ask the assistant about the results.
            </p>
          </div>
        </section>

        {!hasData && (
          <section className="panel" style={{ padding: '28px' }}>
            <EmptyState
              illustration="data"
              title="No analysis data available"
              message="Run a weather and habitability analysis from the Dashboard first, then return here to generate a report or ask questions."
            />
          </section>
        )}

        {hasData && (
          <section className="reports-page">
            <ReportGenerator context={context} />
            <AIChat context={context} />
          </section>
        )}
      </main>
    </div>
  );
};

export default Reports;
