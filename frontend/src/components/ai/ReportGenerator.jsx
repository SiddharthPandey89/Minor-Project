import React, { useCallback, useState } from 'react';
import { generateReport } from '../../services/aiService.js';
import Card from '../common/Card.jsx';
import Loader from '../common/Loader.jsx';
import ErrorMessage from '../common/ErrorMessage.jsx';
import Button from '../common/Button.jsx';

const ReportGenerator = ({ context, className = '' }) => {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = useCallback(async () => {
    setError(null);
    setReport(null);
    setLoading(true);

    try {
      const data = await generateReport({
        region: context?.region,
        weather: context?.weather,
        soil: context?.soil,
        vegetation: context?.vegetation,
        habitability: context?.habitability,
      });
      setReport(data.report);
    } catch (err) {
      setError(err.message || 'The report generation request failed.');
    } finally {
      setLoading(false);
    }
  }, [context]);

  const handleDownload = useCallback(() => {
    if (!report) return;
    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `terraxx-report-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [report]);

  return (
    <Card className={`report-generator ${className}`} padding bordered elevated>
      <Card.Header>
        <div>
          <p className="eyebrow">REPORT GENERATION</p>
          <h2>Generate report</h2>
        </div>
      </Card.Header>
      <Card.Body className="report-generator__body">
        {loading && <Loader label="Generating report…" />}
        {error && <ErrorMessage title="Report error" message={error} onRetry={() => setError(null)} />}
        {!loading && !error && !report && (
          <div className="report-generator__empty">
            <p>No report generated yet. Click below to create a report from the available analysis data.</p>
          </div>
        )}
        {report && (
          <>
            <div className="report-generator__actions">
              <Button variant="secondary" onClick={handleDownload} disabled={loading}>
                Download report (.txt)
              </Button>
              <Button variant="ghost" onClick={() => setReport(null)} disabled={loading}>
                Clear
              </Button>
            </div>
            <div className="report-generator__output">
              <pre className="report-generator__text">{report}</pre>
            </div>
          </>
        )}
        {!loading && !error && !report && (
          <Button variant="primary" onClick={handleGenerate} disabled={!context}>
            Generate report
          </Button>
        )}
      </Card.Body>
    </Card>
  );
};

export default ReportGenerator;
