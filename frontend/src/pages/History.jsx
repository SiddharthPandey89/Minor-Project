import React, { useState, useCallback } from 'react';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Loader from '../components/common/Loader.jsx';
import ErrorMessage from '../components/common/ErrorMessage.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import TrendChart from '../components/charts/TrendChart.jsx';
import { API_BASE_URL } from '../utils/constants.js';

const History = () => {
  const [lat, setLat] = useState('23.2599');
  const [lon, setLon] = useState('77.4126');
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2024-01-31');
  const [compareStart, setCompareStart] = useState('2023-01-01');
  const [compareEnd, setCompareEnd] = useState('2023-01-31');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [showCompare, setShowCompare] = useState(false);

  const fetchHistory = useCallback(async () => {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setError('Please enter valid coordinates.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/analysis/history?latitude=${latitude}&longitude=${longitude}&startDate=${startDate}&endDate=${endDate}`
      );
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Failed to fetch historical data.');
      setData(json.data);

      if (showCompare) {
        const res2 = await fetch(
          `${API_BASE_URL}/api/analysis/history?latitude=${latitude}&longitude=${longitude}&startDate=${compareStart}&endDate=${compareEnd}`
        );
        const json2 = await res2.json();
        if (res2.ok && json2.success) setCompareData(json2.data);
        else setCompareData(null);
      }
    } catch (err) {
      setError(err.message || 'Historical analysis failed.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [lat, lon, startDate, endDate, compareStart, compareEnd, showCompare]);

  const toChartData = (daily, field) =>
    daily?.map((d) => ({
      date: d.date,
      value: d[field],
    })) || [];

  const avg = (arr) => {
    const vals = arr.filter((v) => Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const maxTempData = toChartData(data?.daily, 'temperatureMax');
  const minTempData = toChartData(data?.daily, 'temperatureMin');
  const meanTempData = toChartData(data?.daily, 'temperatureMean');
  const precipData = toChartData(data?.daily, 'precipitation');
  const humidityData = toChartData(data?.daily, 'humidity');

  const compareMaxTemp = compareData?.daily ? avg(compareData.daily.map((d) => d.temperatureMax)) : null;
  const currentMaxTemp = data?.daily ? avg(data.daily.map((d) => d.temperatureMax)) : null;

  return (
    <div className="page history-page">
      <Card padding={false}>
        <Card.Header>
          <div>
            <p className="eyebrow">HISTORICAL ANALYSIS</p>
            <h2>Environmental trends over time</h2>
          </div>
        </Card.Header>
        <Card.Body>
          <div className="history-controls">
            <div className="control-group">
              <label>Latitude</label>
              <input type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} />
            </div>
            <div className="control-group">
              <label>Longitude</label>
              <input type="number" step="any" value={lon} onChange={(e) => setLon(e.target.value)} />
            </div>
            <div className="control-group">
              <label>Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="control-group">
              <label>End date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <label className="compare-toggle">
              <input type="checkbox" checked={showCompare} onChange={(e) => setShowCompare(e.target.checked)} />
              Compare periods
            </label>
            <Button onClick={fetchHistory} disabled={loading}>
              {loading ? 'Loading...' : 'Fetch history'}
            </Button>
          </div>

          {showCompare && (
            <div className="history-controls compare-controls">
              <div className="control-group">
                <label>Compare start</label>
                <input type="date" value={compareStart} onChange={(e) => setCompareStart(e.target.value)} />
              </div>
              <div className="control-group">
                <label>Compare end</label>
                <input type="date" value={compareEnd} onChange={(e) => setCompareEnd(e.target.value)} />
              </div>
            </div>
          )}

          {loading && <Loader />}

          {error && <ErrorMessage message={error} />}

          {data && (
            <>
              <div className="history-charts">
                <TrendChart data={maxTempData} title="Maximum temperature" unit="°C" />
                <TrendChart data={minTempData} title="Minimum temperature" unit="°C" />
                <TrendChart data={meanTempData} title="Average temperature" unit="°C" />
                <TrendChart data={precipData} title="Daily precipitation" unit="mm" />
                <TrendChart data={humidityData} title="Relative humidity" unit="%" />
              </div>

              {showCompare && compareData && (
                <Card padding={false}>
                  <Card.Header><h3>Period comparison</h3></Card.Header>
                  <Card.Body>
                    <div className="comparison-grid">
                      <div className="comparison-item">
                        <span className="label">Current period avg max temp</span>
                        <span className="value">{currentMaxTemp !== null ? currentMaxTemp.toFixed(1) + '°C' : 'N/A'}</span>
                      </div>
                      <div className="comparison-item">
                        <span className="label">Compare period avg max temp</span>
                        <span className="value">{compareMaxTemp !== null ? compareMaxTemp.toFixed(1) + '°C' : 'N/A'}</span>
                      </div>
                      <div className="comparison-item">
                        <span className="label">Change</span>
                        <span className="value">
                          {currentMaxTemp !== null && compareMaxTemp !== null
                            ? (currentMaxTemp - compareMaxTemp > 0 ? '+' : '') + (currentMaxTemp - compareMaxTemp).toFixed(1) + '°C'
                            : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </Card.Body>
                </Card>
              )}

              <div className="history-meta">
                <p>Data source: {data.dataProvider}</p>
                <p>Retrieved: {data.retrievedAt}</p>
                <p>Location: {data.region.latitude}, {data.region.longitude}</p>
                <p>Period: {data.startDate} to {data.endDate}</p>
                <p>Observations: {data.daily?.length || 0} days</p>
              </div>
            </>
          )}

          {data && (!data.daily || data.daily.length === 0) && (
            <EmptyState title="No data" description="No historical data available for the selected range." />
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

export default History;
