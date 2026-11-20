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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

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
    } catch (err) {
      setError(err.message || 'Historical analysis failed.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [lat, lon, startDate, endDate]);

  const chartData = data?.daily?.map((d) => ({
    date: d.date,
    temperatureMean: d.temperatureMean,
    temperatureMax: d.temperatureMax,
    temperatureMin: d.temperatureMin,
    value: d.temperatureMean,
  })) || [];

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
            <Button onClick={fetchHistory} disabled={loading}>
              {loading ? 'Loading...' : 'Fetch history'}
            </Button>
          </div>

          {loading && <Loader />}

          {error && <ErrorMessage message={error} />}

          {data && chartData.length > 0 && (
            <>
              <TrendChart data={chartData} title="Temperature trend" unit="°C" />
              <div className="history-meta">
                <p>Data source: {data.dataProvider}</p>
                <p>Retrieved: {data.retrievedAt}</p>
                <p>Location: {data.region.latitude}, {data.region.longitude}</p>
                <p>Period: {data.startDate} to {data.endDate}</p>
              </div>
            </>
          )}

          {data && chartData.length === 0 && (
            <EmptyState title="No data" description="No historical data available for the selected range." />
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

export default History;
