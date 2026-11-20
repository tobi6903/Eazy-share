// Wires the page together.
import { initDeviceList } from './deviceList.js';
import { loadInbox } from './inbox.js';
import { initPicker } from './picker.js';
import { connectPresence } from './presence.js';
import { initSender } from './sender.js';

initDeviceList();
initPicker();
initSender();
connectPresence({ onInboxChange: () => void loadInbox() });
