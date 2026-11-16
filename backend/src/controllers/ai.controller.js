import { sendSuccess, sendError } from '../utils/response.js';
import { generateReport, chatResponse } from '../services/ai.service.js';

export const generateReportController = (req, res) => {
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendError(res, 'A valid JSON request body is required.', 400);
    return;
  }

  const { region, weather, soil, vegetation, habitability } = body;

  try {
    const report = generateReport({ region, weather, soil, vegetation, habitability });
    sendSuccess(res, { report });
  } catch (error) {
    console.error('Report generation failed:', error.message);
    sendError(res, 'Unable to generate report.', 500);
  }
};

export const chatController = (req, res) => {
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendError(res, 'A valid JSON request body is required.', 400);
    return;
  }

  const { message, context } = body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    sendError(res, 'A message is required.', 400);
    return;
  }

  try {
    const response = chatResponse(message, context || {});
    sendSuccess(res, { response });
  } catch (error) {
    console.error('Chat response failed:', error.message);
    sendError(res, 'Unable to generate chat response.', 500);
  }
};
