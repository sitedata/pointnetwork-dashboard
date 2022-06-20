import { BrowserWindow } from 'electron'
import fs from 'fs-extra'
import axios from 'axios'
import moment from 'moment'
import path from 'node:path'
import tarfs from 'tar-fs'
import url from 'url'
import progress from 'progress-stream'
import find from 'find-process'
import rimraf from 'rimraf'
import { exec } from 'child_process'
import helpers from '../../shared/helpers'
import Logger from '../../shared/logger'
import utils from '../../shared/utils'
// Types
import {
  GenericProgressLog,
  LaunchProcessLog,
  UpdateLog,
} from '../@types/generic'
import { GithubRelease } from '../@types/github-release'
import { FirefoxChannelsEnum } from '../@types/ipc_channels'
import { Process } from '../@types/process'

const dmg = require('dmg')
const bz2 = require('unbzip2-stream')

/**
 * WHAT THIS MODULE DOES
 * 1. Downloads the Firefox Browser
 * 2. Checks for updates whether new Firefox Browser release is available
 * 3. Launches the Firefox Browser
 * 4. Kills the Firefox Browser
 */
class Firefox {
  logger: Logger
  window: BrowserWindow
  pointDir: string = helpers.getPointPath()

  constructor({ window }: { window: BrowserWindow }) {
    this.window = window
    this.logger = new Logger({ window, module: 'firefox' })
  }

  /**
   * Returns the latest available version for Firefox
   */
  async getLatestVersion(): Promise<string> {
    try {
      const res = await axios.get(
        'https://product-details.mozilla.org/1.0/firefox_versions.json'
      )
      return res.data.LATEST_FIREFOX_VERSION
    } catch (error: any) {
      throw new Error(error)
    }
  }

  /**
   * Returns the download URL for the version provided and the file name provided
   */
  async getDownloadURL({
    filename,
    version,
  }: {
    filename: string
    version: string
  }): Promise<string> {
    if (global.platform.win32) {
      const owner = 'pointnetwork'
      const repo = 'phyrox-esr-portable'
      const githubAPIURL = helpers.getGithubAPIURL()
      const githubURL = helpers.getGithubURL()
      const url = `${githubAPIURL}/repos/${owner}/${repo}/releases/latest`
      const fallback = `${githubURL}/${owner}/${repo}/releases/download/91.7.1-58/point-browser-portable-win64-91.7.1-57.zip`
      const re = /point-browser-portable-win64-\d+.\d+.\d+(-\d+)?.zip/

      try {
        const { data } = await axios.get<GithubRelease>(url)
        const browserAsset = data.assets.find(a => re.test(a.name))

        if (!browserAsset) {
          return fallback
        }

        return browserAsset.browser_download_url
      } catch (err) {
        return fallback
      }
    }

    return `https://download.cdn.mozilla.net/pub/mozilla.org/firefox/releases/${version}/${helpers.getOSAndArch()}/en-US/${filename}`
  }

  /**
   * Downloads the Firefox brwoser, extracts it to the .point directory, deletes the downloaded file, and saves the info to infoFirefox.json file
   */
  downloadAndInstall(): Promise<void> {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      try {
        // 0. Delete previous installation
        rimraf.sync(helpers.getBrowserFolderPath())

        // 1. Set the parameters for download
        const version = await this.getLatestVersion()
        let filename = `firefox-${version}.tar.bz2`
        if (global.platform.darwin) {
          filename = `Firefox%20${version}.dmg`
        }
        if (global.platform.win32) filename = `firefox-win-${version}.zip`

        const downloadUrl = await this.getDownloadURL({ version, filename })
        const downloadDest = path.join(this.pointDir, filename)

        const downloadStream = fs.createWriteStream(downloadDest)
        const browserDir = path.join(this.pointDir, 'src', 'point-browser')

        // 2. Start downloading and send logs to window
        this.logger.sendToChannel({
          channel: FirefoxChannelsEnum.download,
          log: JSON.stringify({
            started: true,
            log: 'Starting to download Point Browser',
            progress: 0,
            done: false,
          } as GenericProgressLog),
        })
        await utils.download({
          downloadUrl,
          downloadStream,
          onProgress: progress => {
            this.logger.sendToChannel({
              channel: FirefoxChannelsEnum.download,
              log: JSON.stringify({
                started: true,
                log: 'Downloading Point Browser',
                progress,
                done: false,
              } as GenericProgressLog),
            })
          },
        })
        this.logger.sendToChannel({
          channel: FirefoxChannelsEnum.download,
          log: JSON.stringify({
            started: false,
            log: 'Point Browser downloaded',
            progress: 100,
            done: true,
          } as GenericProgressLog),
        })

        downloadStream.on('close', async () => {
          // Unack
          await this._unpack({ src: downloadDest, dest: browserDir })
          // Create configuration files
          this._createConfigFiles()
          // Delete downloaded file
          fs.unlinkSync(downloadDest)
          // Write JSON file
          fs.writeFileSync(
            path.join(this.pointDir, 'infoFirefox.json'),
            JSON.stringify({
              installedReleaseVersion: version,
              lastCheck: moment().unix(),
              isInitialized: false,
            }),
            'utf8'
          )
          resolve()
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * Launches the Firefox brwoser if Firefox is not running already
   */
  async launch() {
    if ((await this._getRunningProcess()).length)
      return this.logger.sendToChannel({
        channel: FirefoxChannelsEnum.running_status,
        log: JSON.stringify({
          isRunning: true,
          log: 'Point Browser is running',
        } as LaunchProcessLog),
      })

    const binFile = this._getBinFile()
    const profilePath = path.join(
      helpers.getHomePath(),
      '.point/keystore/liveprofile'
    )
    let browserCmd = `"${binFile}" --first-startup --profile "${profilePath}" --url https://point`
    if (global.platform.darwin)
      browserCmd = `open -W "${binFile}" --args --first-startup --profile "${profilePath}" --url https://point`

    this.logger.sendToChannel({
      channel: FirefoxChannelsEnum.running_status,
      log: JSON.stringify({
        isRunning: true,
        log: 'Point Browser is running',
      } as LaunchProcessLog),
    })
    exec(browserCmd, (err, stdout, stderr) => {
      if (err) this.logger.error(err)
      if (stderr) this.logger.error(stderr)
      this.logger.info(stdout)
      this.logger.sendToChannel({
        channel: FirefoxChannelsEnum.running_status,
        log: JSON.stringify({
          isRunning: false,
          log: 'Point Browser is not running',
        } as LaunchProcessLog),
      })
    })
  }

  /**
   * Stops the running instances of Firefox
   */
  async stop() {
    this.logger.sendToChannel({
      channel: FirefoxChannelsEnum.stop,
      log: JSON.stringify({
        started: true,
        log: 'Finding running processes for Point Browser',
        done: false,
      } as GenericProgressLog),
    })
    const process = await this._getRunningProcess()
    if (process.length > 0) {
      for (const p of process) {
        try {
          await utils.kill({ processId: p.pid, onMessage: this.logger.info })
        } catch (err) {
          this.logger.error(err)
        }
      }
    }
    this.logger.sendToChannel({
      channel: FirefoxChannelsEnum.stop,
      log: JSON.stringify({
        started: true,
        log: 'Killed running processes for Point Browser',
        done: false,
      } as GenericProgressLog),
    })
  }

  /**
   * Checks for Point Node updates
   */
  async checkForUpdates() {
    this.logger.sendToChannel({
      channel: FirefoxChannelsEnum.check_for_updates,
      log: JSON.stringify({
        isChecking: true,
        isAvailable: false,
        log: 'Checking for updates',
      } as UpdateLog),
    })
    const installInfo = helpers.getInstalledVersionInfo('firefox')
    const isBinMissing = !fs.existsSync(this._getBinFile())

    if (
      isBinMissing ||
      !installInfo.installedReleaseVersion ||
      moment().diff(moment.unix(installInfo.lastCheck), 'hours') >= 1
    ) {
      const latestVersion = await this.getLatestVersion()

      if (
        installInfo.installedReleaseVersion !== latestVersion ||
        isBinMissing
      ) {
        this.logger.sendToChannel({
          channel: FirefoxChannelsEnum.check_for_updates,
          log: JSON.stringify({
            isChecking: false,
            isAvailable: true,
            log: 'Update available. Proceeding to download the update',
          } as UpdateLog),
        })
      }
    } else {
      this.logger.sendToChannel({
        channel: FirefoxChannelsEnum.check_for_updates,
        log: JSON.stringify({
          isChecking: false,
          isAvailable: false,
          log: 'Already upto date',
        } as UpdateLog),
      })
    }
  }

  /**
   * Unpacks the Firefox brwoser based on the platform
   */
  async _unpack({ src, dest }: { src: string; dest: string }): Promise<void> {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      const _resolve = () => {
        this.logger.sendToChannel({
          channel: FirefoxChannelsEnum.unpack,
          log: JSON.stringify({
            started: false,
            log: 'Unpacked Point Browser',
            done: true,
            progress: 100,
          } as GenericProgressLog),
        })
        resolve()
      }
      try {
        this.logger.sendToChannel({
          channel: FirefoxChannelsEnum.unpack,
          log: JSON.stringify({
            started: true,
            log: 'Unpacking Point Browser (this might take a few minutes)',
            done: false,
            progress: 0,
          } as GenericProgressLog),
        })

        if (global.platform.win32) {
          await utils.extractZip({
            src,
            dest,
            onProgress: (progress: number) => {
              this.logger.sendToChannel({
                channel: FirefoxChannelsEnum.unpack,
                log: JSON.stringify({
                  started: true,
                  log: 'Unpacking Point Browser',
                  done: false,
                  progress,
                } as GenericProgressLog),
              })
            },
          })
          _resolve()
        }

        if (global.platform.darwin) {
          dmg.mount(src, async (_err: any, dmgPath: any) => {
            try {
              const src = `${dmgPath}/Firefox.app`
              const dst = `${dest}/Firefox.app`

              const totalFiles = await helpers.countFilesinDir(src)
              let filesCopied = 0

              await fs.copy(src, dst, {
                filter: src => {
                  if (fs.statSync(src).isFile()) {
                    filesCopied++
                    const progress = Math.round(
                      (filesCopied / totalFiles) * 100
                    )

                    this.logger.sendToChannel({
                      channel: FirefoxChannelsEnum.unpack,
                      log: JSON.stringify({
                        started: true,
                        log: 'Unpacking Point Browser',
                        done: false,
                        progress,
                      } as GenericProgressLog),
                    })
                  }
                  return true // To actually copy the file
                },
              })
            } catch (err: any) {
              reject(err)
            } finally {
              dmg.unmount(dmgPath, (err: any) => {
                if (err) reject(err)
                _resolve()
              })
            }
          })
        }

        if (global.platform.linux) {
          const stats = fs.statSync(src)
          const progressStream = progress({ length: stats.size, time: 250 })
          progressStream.on('progress', p => {
            this.logger.sendToChannel({
              channel: FirefoxChannelsEnum.unpack,
              log: JSON.stringify({
                started: true,
                log: 'Unpacking Point Browser',
                done: false,
                progress: Math.round(p.percentage),
              } as GenericProgressLog),
            })
          })

          const readStream = fs
            .createReadStream(src)
            .pipe(progressStream)
            .pipe(bz2())
            .pipe(tarfs.extract(dest))

          readStream.on('finish', _resolve)
        }
      } catch (error: any) {
        reject(error)
      }
    })
  }

  /**
   * Create configuration files for Firefox
   */
  _createConfigFiles(): void {
    try {
      const pacFile = url.pathToFileURL(
        path.join(
          helpers.getLiveDirectoryPathResources(),
          'resources',
          'pac.js'
        )
      )
      let configFilename = 'firefox.cfg'
      if (global.platform.win32) {
        configFilename = 'portapps.cfg'
      }

      const autoconfigContent = `pref("general.config.filename", "${configFilename}");
pref("general.config.obscure_value", 0);
`
      const firefoxCfgContent = `
// IMPORTANT: Start your code on the 2nd line
// pref('network.proxy.type', 1)
pref("intl.locale.requested", "en-US");
pref("browser.rights.3.shown", true);
pref("browser.startup.homepage_override.mstone", "ignore");
pref('network.proxy.type', 2)
pref('network.proxy.http', 'localhost')
pref('network.proxy.http_port', 8666)
pref('browser.startup.homepage', 'https://point')
pref('startup.homepage_welcome_url', 'https://point/welcome')
pref('startup.homepage_welcome_url.additional', '')
pref('startup.homepage_override_url', '')
pref('network.proxy.allow_hijacking_localhost', true)
pref('browser.fixup.domainsuffixwhitelist.z', true)
pref('browser.fixup.domainsuffixwhitelist.point', true)
pref('browser.shell.checkDefaultBrowser', false)
pref('app.normandy.first_run', false)
pref('browser.laterrun.enabled', true)
pref('doh-rollout.doneFirstRun', true)
pref('trailhead.firstrun.didSeeAboutWelcome', true)
pref('toolkit.telemetry.reportingpolicy.firstRun', false)
pref('toolkit.startup.max_resumed_crashes', -1)
pref('browser.shell.didSkipDefaultBrowserCheckOnFirstRun', true)
pref('app.shield.optoutstudies.enabled', false)
pref('network.proxy.autoconfig_url', '${pacFile}')
pref('security.enterprise_roots.enabled', true)
pref('network.captive-portal-service.enabled', false)
pref('browser.tabs.drawInTitlebar', true)
pref('extensions.enabledScopes', 0)
pref('extensions.autoDisableScopes', 0)
pref("extensions.startupScanScopes", 15)
pref("trailhead.firstrun.branches", "nofirstrun-empty")
pref("browser.aboutwelcome.enabled", false)
pref("browser.sessionstore.resume_session_once", false)
pref("browser.sessionstore.resume_from_crash", false)
pref("browser.startup.upgradeDialog.enabled", false)
`
      const policiesCfgContent = `{
  "policies": {
      "DisableAppUpdate": true
    }
}`
      // Write the autoconfig file
      fs.writeFileSync(
        path.join(this._getPrefPath(), 'autoconfig.js'),
        autoconfigContent
      )
      // Write the firefox config file
      fs.writeFileSync(
        path.join(this._getAppPath(), configFilename),
        firefoxCfgContent
      )
      // Write the policies file
      fs.writeFileSync(
        path.join(this._getPoliciesPath(), 'policies.json'),
        policiesCfgContent
      )
    } catch (error: any) {
      throw new Error(error)
    }
  }

  /**
   * Returns the path where Firefox installation resides
   */
  _getRootPath(): string {
    if (global.platform.win32 || global.platform.darwin) {
      return path.join(helpers.getBrowserFolderPath())
    }
    return path.join(helpers.getBrowserFolderPath(), 'firefox')
  }

  /**
   * Returns the app path for the Firefox installation
   */
  _getAppPath(): string {
    const rootPath = this._getRootPath()

    let appPath = rootPath
    if (global.platform.win32) appPath = path.join(rootPath, 'app')
    if (global.platform.darwin)
      appPath = path.join(rootPath, 'Firefox.app', 'Contents', 'Resources')

    if (!fs.existsSync(appPath)) {
      fs.mkdirSync(appPath)
    }

    return appPath
  }

  /**
   * Returns the pref path for the Firefox installation
   */
  _getPrefPath(): string {
    const rootPath = this._getRootPath()

    if (global.platform.linux) return path.join(rootPath, 'defaults', 'pref')

    const defaultsPath = path.join(this._getAppPath(), 'defaults')
    const prefPath = path.join(defaultsPath, 'pref')

    if (!fs.existsSync(defaultsPath)) {
      fs.mkdirSync(defaultsPath)
    }
    if (!fs.existsSync(prefPath)) {
      fs.mkdirSync(prefPath)
    }
    return prefPath
  }

  /**
   * Returns the policies path for the Firefox installation
   */
  _getPoliciesPath(): string {
    const rootPath = this._getRootPath()
    let distributionPath = path.join(this._getAppPath(), 'distribution')
    if (global.platform.linux)
      distributionPath = path.join(rootPath, 'distribution')

    if (!fs.existsSync(distributionPath)) {
      fs.mkdirSync(distributionPath)
    }
    return distributionPath
  }

  /**
   * Returns the executable bin path for the Firefox installation
   */
  _getBinFile() {
    const rootPath = this._getRootPath()
    if (global.platform.win32) {
      // return path.join(rootPath, 'point-browser-portable.exe')
      return path.join(rootPath, 'app', 'firefox.exe')
    }
    if (global.platform.darwin) {
      return `${path.join(rootPath, 'Firefox.app')}`
    }
    // linux
    return path.join(rootPath, 'firefox')
  }

  /**
   * Returns the running instances of Firefox
   */
  async _getRunningProcess(): Promise<Process[]> {
    return await (
      await find('name', /firefox/i)
    ).filter(p => p.cmd.includes('point-browser') && !p.cmd.includes('tab'))
  }
}

export default Firefox
