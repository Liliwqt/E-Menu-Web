import { auth } from './firebase';
import { API_BASE } from './apiBase';
import { createBackendTransport } from './backendTransport.js';
export const backendFetch = createBackendTransport({ base: API_BASE, getToken: () => auth.currentUser?.getIdToken() });
