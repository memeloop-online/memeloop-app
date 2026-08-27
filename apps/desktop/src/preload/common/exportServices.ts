import { contextBridge } from 'electron';
import * as service from './services';

// add window.service for renderer content
contextBridge.exposeInMainWorld('service', service);
// for preload script to use
window.service = service;
