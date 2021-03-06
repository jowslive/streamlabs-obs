import Vue from 'vue';
import URI from 'urijs';
import { defer } from 'lodash';
import { PersistentStatefulService } from './persistent-stateful-service';
import { Inject } from '../util/injector';
import { mutation } from './stateful-service';
import electron from 'electron';
import { HostsService } from './hosts';
import { getPlatformService, IPlatformAuth, TPlatform } from './platforms';
import { CustomizationService } from './customization';
import Raven from 'raven-js';

// Eventually we will support authing multiple platforms at once
interface IUserServiceState {
  auth?: IPlatformAuth;
}

export class UserService extends PersistentStatefulService<IUserServiceState> {
  @Inject() hostsService: HostsService;
  @Inject() customizationService: CustomizationService;

  @mutation()
  LOGIN(auth: IPlatformAuth) {
    Vue.set(this.state, 'auth', auth);
  }

  @mutation()
  LOGOUT() {
    Vue.delete(this.state, 'auth');
  }

  init() {
    super.init();
    this.setRavenContext();
    this.validateLogin();
  }

  mounted() {
    // This is used for faking authentication in tests.  We have
    // to do this because Twitch adds a captcha when we try to
    // actually log in from integration tests.
    electron.ipcRenderer.on(
      'testing-fakeAuth',
      (e: Electron.Event, auth: any) => {
        this.LOGIN(auth);
      }
    );
  }

  // Makes sure the user's login is still good
  validateLogin() {
    if (!this.isLoggedIn()) return;

    const host = this.hostsService.streamlabs;
    const token = this.widgetToken;
    const url = `https://${host}/api/v5/slobs/validate/${token}`;
    const request = new Request(url);

    fetch(request)
      .then(res => {
        return res.text();
      })
      .then(valid => {
        if (valid.match(/false/)) this.LOGOUT();
      });
  }

  isLoggedIn() {
    return !!(this.state.auth && this.state.auth.widgetToken);
  }

  /**
   * This is a uuid that persists across the application lifetime and uniquely
   * identifies this particular installation of slobs, even when the user is
   * not logged in.
   */
  getLocalUserId() {
    const localStorageKey = 'SlobsLocalUserId';
    let userId = localStorage.getItem(localStorageKey);

    if (!userId) {
      userId = electron.ipcRenderer.sendSync('getUniqueId');
      localStorage.setItem(localStorageKey, userId);
    }

    return userId;
  }

  get widgetToken() {
    if (this.isLoggedIn()) {
      return this.state.auth.widgetToken;
    }
  }

  get platform() {
    if (this.isLoggedIn()) {
      return this.state.auth.platform;
    }
  }

  get username() {
    if (this.isLoggedIn()) {
      return this.state.auth.platform.username;
    }
  }

  get platformId() {
    if (this.isLoggedIn()) {
      return this.state.auth.platform.id;
    }
  }

  widgetUrl(type: string) {
    if (this.isLoggedIn()) {
      const host = this.hostsService.streamlabs;
      const token = this.widgetToken;
      const nightMode = this.customizationService.nightMode ? 'night' : 'day';

      if (type === 'recent-events') {
        return `https://${host}/dashboard/recent-events?token=${token}&mode=${
          nightMode
        }&electron`;
      }

      if (type === 'dashboard') {
        return `https://${host}/slobs/dashboard/${token}?mode=${
          nightMode
        }&show_recent_events=0`;
      }
    }
  }

  overlaysUrl() {
    const host = this.hostsService.beta2;
    const uiTheme = this.customizationService.nightMode ? 'night' : 'day';
    let url = `https://${host}/marketplace?mode=${uiTheme}&slobs`;

    if (this.isLoggedIn()) {
      url = url + `&token=${this.widgetToken}`;
    }

    return url;
  }

  logOut() {
    this.LOGOUT();
  }

  /**
   * Starts the authentication process.  Multiple callbacks
   * can be passed for various events.
   */
  startAuth(
    platform: TPlatform,
    onWindowShow: Function,
    onAuthFinish: Function
  ) {
    const service = getPlatformService(platform);

    const authWindow = new electron.remote.BrowserWindow({
      ...service.authWindowOptions,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        nodeIntegration: false
      }
    });

    authWindow.webContents.on('did-navigate', (e, url) => {
      const parsed = this.parseAuthFromUrl(url);

      if (parsed) {
        authWindow.close();
        this.LOGIN(parsed);
        this.setRavenContext();
        service.setupStreamSettings(parsed);
        defer(onAuthFinish);
      }
    });

    authWindow.once('ready-to-show', () => {
      authWindow.show();
      defer(onWindowShow);
    });

    authWindow.setMenu(null);
    authWindow.loadURL(service.authUrl);
  }

  /**
   * Parses tokens out of the auth URL
   */
  private parseAuthFromUrl(url: string) {
    const query = URI.parseQuery(URI.parse(url).query);

    if (
      query.token &&
      query.platform_username &&
      query.platform_token &&
      query.platform_id
    ) {
      return {
        widgetToken: query.token,
        platform: {
          type: query.platform,
          username: query.platform_username,
          token: query.platform_token,
          id: query.platform_id
        }
      } as IPlatformAuth;
    }

    return false;
  }

  /**
   * Registers the current user information with Raven so
   * we can view more detailed information in sentry.
   */
  setRavenContext() {
    if (!this.isLoggedIn()) return;
    Raven.setUserContext({ username: this.username });
    Raven.setExtraContext({ platform: this.platform.type });
  }
}

/**
 * You can use this decorator to ensure the user is logged in
 * before proceeding
 */
export function requiresLogin() {
  return (target: any, methodName: string, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;

    return {
      ...descriptor,
      value(...args: any[]) {
        // TODO: Redirect to login if not logged in?
        if (UserService.instance.isLoggedIn())
          return original.apply(target, args);
      }
    };
  };
}
