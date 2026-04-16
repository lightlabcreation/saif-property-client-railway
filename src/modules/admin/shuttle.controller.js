const axios = require('axios');
const catchAsync = require('../../utils/catchAsync');

// The external Shuttle API URL
// In production, this should be set in .env (e.g. process.env.SHUTTLE_API_URL || 'http://localhost:5001')
const SHUTTLE_API_URL = (process.env.SHUTTLE_API_URL || 'http://localhost:5001').replace(/^["'](.+)["']$/, '$1');

/**
 * Helper to proxy requests to the Morgan Shuttle Backend
 */
const proxyRequest = async (method, url, data = null, params = {}, headers = {}) => {
  try {
    const fullUrl = `${SHUTTLE_API_URL}/api${url}`;
    console.log(`[ShuttleProxy] Calling: ${method} ${fullUrl}`);
    const config = {
      method,
      url: fullUrl,
      params,
      timeout: 10000,
      headers: { 
        ...headers,
        'User-Agent': 'PMS-Backend-Proxy'
      }
    };

    if (data && method !== 'GET') {
      config.data = data;
      config.headers['Content-Type'] = 'application/json';
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    if (error.response) {
      console.error(`[ShuttleProxy] Error ${error.response.status}:`, error.response.data);
      throw { status: error.response.status, message: error.response.data.message || 'Shuttle API Error', data: error.response.data };
    }
    console.error(`[ShuttleProxy] Network Error:`, error.message);
    throw { status: 500, message: 'Shuttle Server Unreachable', error: error.message };
  }
};

/**
 * @desc    Get all active trips (Daily Schedule)
 * @route   GET /api/admin/shuttle/trips
 */
const getTrips = catchAsync(async (req, res) => {
  try {
    const { date } = req.query;
    const data = await proxyRequest('GET', '/trips', null, { date }); 
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Create a one-off trip or base trip
 * @route   POST /api/admin/shuttle/trips
 */
const createTrip = catchAsync(async (req, res) => {
  try {
    const { seats_total, ...rest } = req.body;
    const data = await proxyRequest('POST', '/trips', {
      ...rest,
      seats_total: parseInt(seats_total, 10) || 7
    });
    res.json({ success: true, trip: data.trip });
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Create a new ride request on behalf of a tenant
 * @route   POST /api/admin/shuttle/requests
 */
const createRequest = catchAsync(async (req, res) => {
  try {
    const { passengers, ...rest } = req.body;
    
    // Proxy to Shuttle Backend: POST /api/trips/request
    // We parse passengers to Int to ensure Prisma compatibility in the Shuttle backend
    const data = await proxyRequest('POST', '/trips/request', {
      ...rest,
      passengers: parseInt(passengers, 10) || 1,
      source: 'admin_pms'
    });
    res.status(201).json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Get all ride requests (Inbox)
 * @route   GET /api/admin/shuttle/requests
 */
const getRequests = catchAsync(async (req, res) => {
  try {
    const data = await proxyRequest('GET', '/trips/requests'); 
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Approve or Reject a Ride Request
 * @route   PUT /api/admin/shuttle/requests/:id/status
 */
const updateRequestStatus = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const action = status === 'approved' ? 'approve' : 'reject';
    
    // Proxy the approval to the shuttle backend
    // Route: POST /api/trips/requests/:id/approve (or reject)
    const data = await proxyRequest('POST', `/trips/requests/${id}/${action}`);
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Get all shuttle users/drivers for access management
 * @route   GET /api/admin/shuttle/users
 */
const getUsers = catchAsync(async (req, res) => {
  try {
    const data = await proxyRequest('GET', '/users');
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Delete a specific trip
 */
const deleteTrip = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const data = await proxyRequest('DELETE', `/trips/${id}`);
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Update a specific trip
 * @route   PUT /api/admin/shuttle/trips/:id
 */
const updateTrip = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const { seats_total, ...rest } = req.body;
    
    // We use PATCH because the Shuttle Backend expects PATCH for specific updates
    const data = await proxyRequest('PATCH', `/trips/${id}`, {
      ...rest,
      seats_total: seats_total !== undefined ? parseInt(seats_total, 10) : undefined
    });
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

/**
 * @desc    Duplicate a day's schedule to another date
 */
const duplicateDay = catchAsync(async (req, res) => {
  try {
    const { sourceDate, targetDate } = req.body;
    
    // 1. Get source trips
    const sourceData = await proxyRequest('GET', '/trips', null, { date: sourceDate });
    const sourceTrips = sourceData.trips || [];
    
    if (sourceTrips.length === 0) {
      return res.status(400).json({ success: false, message: 'No trips found on source date to duplicate.' });
    }

    // 2. Map trips to target date and remove IDs
    const newTrips = sourceTrips.map(t => ({
      time: t.time,
      date: targetDate,
      origin: t.origin,
      destination: t.destination,
      seats_total: t.seats_total,
      is_special: t.is_special
    }));

    // 3. Sequential Create (or handle bulk if shuttle backend supports it)
    const results = [];
    for (const tripData of newTrips) {
      const result = await proxyRequest('POST', '/trips', tripData);
      results.push(result.trip);
    }

    res.json({ success: true, duplicated: results.length, trips: results });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to duplicate day', error: error.message });
  }
});

module.exports = {
  proxyRequest,
  getTrips,
  createTrip,
  deleteTrip,
  duplicateDay,
  getRequests,
  updateRequestStatus,
  getUsers,
  updateTrip,
  createRequest
};
