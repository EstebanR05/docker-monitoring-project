import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  stages: [
    { duration: '15s', target: 10 },
    { duration: '30s', target: 25 },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

export default function () {
  // 1. Check root endpoint (verifies load balancing across backend instances)
  const rootRes = http.get(`${BASE_URL}/`);
  check(rootRes, {
    'GET / status is 200': (r) => r.status === 200,
    'GET / returns instanceId': (r) => {
      try {
        return Boolean(r.json('instanceId'));
      } catch {
        return false;
      }
    },
  });

  // 2. Create a new incident
  const payload = JSON.stringify({
    title: `Load test incident ${__VU}-${__ITER}`,
    description: 'Automated incident generated during k6 load testing',
    type: 'infrastructure',
    zone: 'us-east-1',
  });

  const postRes = http.post(`${BASE_URL}/incidents`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(postRes, {
    'POST /incidents status is 201': (r) => r.status === 201,
    'POST /incidents returns id': (r) => {
      try {
        return Boolean(r.json('id'));
      } catch {
        return false;
      }
    },
  });

  // 3. List incidents
  const listRes = http.get(`${BASE_URL}/incidents`);
  check(listRes, {
    'GET /incidents status is 200': (r) => r.status === 200,
    'GET /incidents returns array': (r) => {
      try {
        return Array.isArray(r.json());
      } catch {
        return false;
      }
    },
  });

  sleep(0.5);
}
