import { contextBridge, ipcRenderer } from 'electron'
import {
  DashboardChannelsEnum,
  GenericChannelsEnum,
} from '../@types/ipc_channels'

declare global {
  // eslint-disable-next-line
  interface Window {
    Welcome: typeof api
  }
}

export const api = {
  generateMnemonic: () => {
    ipcRenderer.send('welcome:generate_mnemonic')
  },
  validateMnemonic: (value: any) => {
    ipcRenderer.send('welcome:validate_mnemonic', value)
  },
  login: (object: any) => {
    ipcRenderer.send('welcome:login', object)
  },
  on: (channel: string, callback: Function) => {
    ipcRenderer.on(channel, (_, data) => callback(data))
  },
  copyMnemonic: (value: any) => {
    ipcRenderer.send('welcome:copy_mnemonic', value)
  },
  pasteMnemonic: () => {
    ipcRenderer.send('welcome:paste_mnemonic')
  },
  getDictionary: () => {
    ipcRenderer.send('welcome:get_dictionary')
  },
  launchUninstaller: () => {
    ipcRenderer.send('welcome:launchUninstaller')
  },
  getDashboardVersion: () => {
    ipcRenderer.send(DashboardChannelsEnum.get_version)
  },
  minimizeWindow: () => {
    ipcRenderer.send(GenericChannelsEnum.minimize_window)
  },
  closeWindow: () => {
    ipcRenderer.send(GenericChannelsEnum.close_window)
  },
}

contextBridge.exposeInMainWorld('Welcome', api)
