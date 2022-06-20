import axios from 'axios'
import { BrowserWindow } from 'electron'
import fs from 'fs-extra'
import path from 'node:path'
import helpers from '../../shared/helpers'
import Logger from '../../shared/logger'

// TODO: Add JSDoc comments
/**
 * WHAT THIS MODULE DOES
 * 1. Downloads the Point Uninstaller
 * 2. Checks for updates whether new Point Uninstaller release is available
 * 3. Launches the Point Uninstaller
 */
class Bounty {
  logger: Logger
  window: BrowserWindow
  pointDir: string = helpers.getPointPath()
  referralCode: string = '000000000000'
  isInstalledEventSent: boolean = false

  constructor({ window }: { window: BrowserWindow }) {
    this.window = window
    this.logger = new Logger({ window, module: 'bounty' })
    this._getReferralCode()
  }

  /**
   * Sends the referral code to bounty server with `event=install`
   */
  async sendInstalled(): Promise<void> {
    await axios.get(
      `https://bounty.pointnetwork.io/ref_success?event=install&ref=${this.referralCode}&addr=0x0000000000000000000000000000000000000000`
    )
    this.isInstalledEventSent = true
    this.logger.info('Sent event=install to https://bounty.pointnetwork.io')
  }

  /**
   * Sends the referral code to bounty server with `event=install_started`
   */
  async sendInstallStarted(): Promise<void> {
    await axios.get(
      `https://bounty.pointnetwork.io/ref_success?event=install_started&ref=${this.referralCode}&addr=0x0000000000000000000000000000000000000000`
    )
    this.logger.info(
      'Sent event=install_started to https://bounty.pointnetwork.io'
    )
    this._saveReferralInfo()
  }

  /**
   * Saves that referral code in ~/.point/infoReferral.json
   */
  _saveReferralInfo() {
    this.logger.info('Saving referralCode to "infoReferral.json"')
    fs.writeFileSync(
      path.join(this.pointDir, 'infoReferral.json'),
      JSON.stringify({
        referralCode: this.referralCode,
        isInstalledEventSent: this.isInstalledEventSent,
      })
    )
    this.logger.info('Saved referralCode to "infoReferral.json"')
  }

  /**
   * Reads various directories and sets the referralCode
   */
  _getReferralCode(): void {
    // Get referral code from the trash folder
    let trashDir
    let trashDirContent: string[] = []

    this.logger.info('Beginning the process to check the referralCode')
    if (global.platform.darwin) {
      try {
        this.logger.info('Reading ".Trash" directory')
        trashDir = path.join(helpers.getHomePath(), '.Trash')
        trashDirContent = fs.readdirSync(trashDir)
        this.logger.info('".Trash" directory read')
      } catch (e) {
        this.logger.info('Not allowed to read ".Trash" directory')
      }
    }

    // Get referral code from the downloads folder
    let downloadDir
    let downloadDirContent: string[] = []
    try {
      this.logger.info('Reading "Downloads" directory')
      downloadDir = path.join(helpers.getHomePath(), 'Downloads')
      downloadDirContent = fs.readdirSync(downloadDir)
      this.logger.info('"Downloads" directory read')
    } catch (e) {
      this.logger.info('Not allowed to read "Downloads" directory')
    }

    // Get referral code from the desktop folder
    let desktopDir
    let desktopDirContent: string[] = []
    try {
      this.logger.info('Reading "Desktop" directory')
      desktopDir = path.join(helpers.getHomePath(), 'Desktop')
      desktopDirContent = fs.readdirSync(desktopDir)
      this.logger.info('"Desktop" directory read')
    } catch (e) {
      this.logger.info('Not allowed to read "Desktop" directory')
    }

    // Make sure it's one of our file downloads and pick the first one
    const matchDir = [
      ...downloadDirContent,
      ...desktopDirContent,
      ...trashDirContent,
    ]
      .filter(
        (dir: string) =>
          dir.includes('point-') &&
          dir.match(/-\d{12}\./) &&
          (dir.includes('Linux-Debian-Ubuntu') ||
            dir.includes('Linux-RPM-Centos-Fedora') ||
            dir.includes('MacOS-installer') ||
            dir.includes('Windows-installer'))
      )
      .map((dir: string) => path.join(helpers.getHomePath(), dir))[0]

    let requiredDir
    if (matchDir) {
      this.logger.info('File with Referral Code exists')
      // Strip the file extension
      requiredDir = matchDir
        .replace('.tar.gz', '')
        .replace('.zip', '')
        .replace('.tar', '')
        .replace(/\(\d+\)+/g, '')
        .trim()
      // Get the referral code
      this.referralCode = requiredDir.slice(requiredDir.length - 12)
    }
    if (
      Number.isNaN(Number(this.referralCode)) ||
      Number(this.referralCode) < 0
    )
      this.referralCode = '000000000000'

    this.logger.info('Referral Code: ', this.referralCode)
  }
}

export default Bounty
