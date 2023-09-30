import '../css/styles.css';

import type { IpcRendererEvent } from 'electron';
import React, { Fragment, useEffect, useState } from 'react';
import {
  Breadcrumbs,
  Button,
  Item,
  Link,
  Menu,
  MenuTrigger,
  Popover,
  Tooltip,
  TooltipTrigger,
} from 'react-aria-components';
import {
  LoaderFunction,
  NavLink,
  Outlet,
  useLoaderData,
  useLocation,
  useNavigate,
  useParams,
  useRouteLoaderData,
} from 'react-router-dom';
/**** ><> ↑ --------- Imports */

import {
  getFirstName,
  getLastName,
  isLoggedIn,
  logout,
  onLoginLogout,
} from '../../account/session';
import { isDevelopment } from '../../common/constants';
import * as models from '../../models';
import { isDefaultOrganization } from '../../models/organization';
import { Settings } from '../../models/settings';
import { isDesign } from '../../models/workspace';
import { reloadPlugins } from '../../plugins';
import { createPlugin } from '../../plugins/create';
import { setTheme } from '../../plugins/misc';
import { exchangeCodeForToken } from '../../sync/git/github-oauth-provider';
import { exchangeCodeForGitLabToken } from '../../sync/git/gitlab-oauth-provider';
/**** ><> ↑ --------- Account and Models */
import { submitAuthCode } from '../auth-session-provider';
import { WorkspaceDropdown } from '../components/dropdowns/workspace-dropdown';
import { GitHubStarsButton } from '../components/github-stars-button';
import { Hotkey } from '../components/hotkey';
import { Icon } from '../components/icon';
import { InsomniaLogo } from '../components/insomnia-icon';
import { showError, showModal } from '../components/modals';
import { AlertModal } from '../components/modals/alert-modal';
import { AskModal } from '../components/modals/ask-modal';
import { ImportModal } from '../components/modals/import-modal';

import {
  /**** ><> ↑ --------- Modal Components */
  SettingsModal,
  showSettingsModal,
  TAB_INDEX_PLUGINS,
  TAB_INDEX_THEMES } from '../components/modals/settings-modal';
import { Toast } from '../components/toast';
import { AppHooks } from '../containers/app-hooks';
import { AIProvider } from '../context/app/ai-context';
import { NunjucksEnabledProvider } from '../context/nunjucks/nunjucks-enabled-context';
/**** ><> ↑ --------- Settings and Themes */
import { useSettingsPatcher } from '../hooks/use-request';
import Modals from './modals';
import { useOrganizationLoaderData } from './organization';
import { WorkspaceLoaderData } from './workspace';

/**** ><> ↑ --------- Hooks and Containers */
export interface RootLoaderData {
  settings: Settings;
}

export const loader: LoaderFunction = async (): Promise<RootLoaderData> => {
  return {
    settings: await models.settings.getOrCreate(),
  };
};
/**** ><> ↑ --------- Root Loader Data */

const getNameInitials = (name: string) => {
  // Split on whitespace and take first letter of each word
  const words = name.toUpperCase().split(' ');
  const firstWord = words[0];
  const lastWord = words[words.length - 1];

  // If there is only one word, just take the first letter
  if (words.length === 1) {
    return firstWord.charAt(0);
  }

  // If the first word is an emoji or an icon then just use that
  const iconMatch = firstWord.match(/\p{Extended_Pictographic}/u);
  if (iconMatch) {
    return iconMatch[0];
  }

  return `${firstWord.charAt(0)}${lastWord ? lastWord.charAt(0) : ''}`;
};
/**** ><> ↑ --------- Helper Function */

const Root = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { settings } = useLoaderData() as RootLoaderData;
  const { organizations } = useOrganizationLoaderData();
  const workspaceData = useRouteLoaderData(
    ':workspaceId'
  ) as WorkspaceLoaderData | null;
  const [importUri, setImportUri] = useState('');
  const patchSettings = useSettingsPatcher();

  useEffect(() => {
    onLoginLogout(() => {
      // Update the hash of the current route to force revalidation of data
      navigate({
        pathname: location.pathname,
        hash: 'revalidate=true',
      });
    });
  }, [location.pathname, navigate]);

  useEffect(() => {
    return window.main.on(
      'shell:open',
      async (_: IpcRendererEvent, url: string) => {
        // Get the url without params
        let parsedUrl;
        try {
          parsedUrl = new URL(url);
        } catch (err) {
          console.log('Invalid args, expected insomnia://x/y/z', url);
          return;
        }
        let urlWithoutParams = url.substring(0, url.indexOf('?')) || url;
        const params = Object.fromEntries(parsedUrl.searchParams);
        // Change protocol for dev redirects to match switch case
        if (isDevelopment()) {
          urlWithoutParams = urlWithoutParams.replace(
            'insomniadev://',
            'insomnia://'
          );
        }
        switch (urlWithoutParams) {
          case 'insomnia://app/alert':
            showModal(AlertModal, {
              title: params.title,
              message: params.message,
            });
            break;



          case 'insomnia://app/import':
            setImportUri(params.uri);
            break;

          case 'insomnia://plugins/install':
            showModal(AskModal, {
              title: 'Plugin Install',
              message: (
                <>
                  Do you want to install <code>{params.name}</code>?
                </>
              ),
              yesText: 'Install',
              noText: 'Cancel',
              onDone: async (isYes: boolean) => {
                if (isYes) {
                  try {
                    await window.main.installPlugin(params.name);
                    showModal(SettingsModal, { tab: TAB_INDEX_PLUGINS });
                  } catch (err) {
                    showError({
                      title: 'Plugin Install',
                      message: 'Failed to install plugin',
                      error: err.message,
                    });
                  }
                }
              },
            });
            break;

          case 'insomnia://plugins/theme':
            const parsedTheme = JSON.parse(decodeURIComponent(params.theme));
            showModal(AskModal, {
              title: 'Install Theme',
              message: (
                <>
                  Do you want to install <code>{parsedTheme.displayName}</code>?
                </>
              ),
              yesText: 'Install',
              noText: 'Cancel',
              onDone: async (isYes: boolean) => {
                if (isYes) {
                  const mainJsContent = `module.exports.themes = [${JSON.stringify(
                    parsedTheme,
                    null,
                    2
                  )}];`;
                  await createPlugin(
                    `theme-${parsedTheme.name}`,
                    '0.0.1',
                    mainJsContent
                  );
                  patchSettings({ theme: parsedTheme.name });
                  await reloadPlugins();
                  await setTheme(parsedTheme.name);
                  showModal(SettingsModal, { tab: TAB_INDEX_THEMES });
                }
              },
            });
            break;

          case 'insomnia://oauth/github/authenticate': {
            const { code, state } = params;
            await exchangeCodeForToken({ code, state }).catch(
              (error: Error) => {
                showError({
                  error,
                  title: 'Error authorizing GitHub',
                  message: error.message,
                });
              }
            );
            break;
          }

          case 'insomnia://oauth/gitlab/authenticate': {
            const { code, state } = params;
            await exchangeCodeForGitLabToken({ code, state }).catch(
              (error: Error) => {
                showError({
                  error,
                  title: 'Error authorizing GitLab',
                  message: error.message,
                });
              }
            );
            break;
          }

          case 'insomnia://app/auth/finish': {
            submitAuthCode(params.box);
            break;
          }

          default: {
            console.log(`Unknown deep link: ${url}`);
          }
        }
      }
    );
  }, [patchSettings]);

  const { organizationId, projectId, workspaceId } = useParams() as {
    organizationId: string;
    projectId?: string;
    workspaceId?: string;
  };

  const crumbs = workspaceData
    ? [
        {
          id: workspaceData.activeProject._id,
          label: workspaceData.activeProject.name,
          node: (
            <Link data-testid="project">
              <NavLink
                to={`/organization/${organizationId}/project/${workspaceData.activeProject._id}`}
              >
                {workspaceData.activeProject.name}
              </NavLink>
            </Link>
          ),
        },
        {
          id: workspaceData.activeWorkspace._id,
          label: workspaceData.activeWorkspace.name,
          node: <WorkspaceDropdown />,
        },
      ]
    : [];

  return (
    <AIProvider>
      <NunjucksEnabledProvider>
        <AppHooks />
        <div className="app">
          <Modals />
          {/* triggered by insomnia://app/import */}
          {importUri && (
            <ImportModal
              onHide={() => setImportUri('')}
              projectName="Insomnium"
              organizationId={organizationId}
              from={{ type: 'uri', defaultValue: importUri }}
            />
          )}
          <div className="w-full h-full divide-x divide-solid divide-y divide-[--hl-md] grid-template-app-layout grid relative bg-[--color-bg]">
            <header className="[grid-area:Header] grid grid-cols-3 items-center">
              <div className="flex items-center">
                <div className="flex w-[50px] py-2">
                  <InsomniaLogo />
                </div>

              </div>
              <div className="flex gap-2 flex-nowrap items-center justify-center">
                {workspaceData && (
                  <Fragment>
                    <Breadcrumbs items={crumbs}>
                      {item => (
                        <Item key={item.id} id={item.id}>
                          {item.node}
                        </Item>
                      )}
                    </Breadcrumbs>
                    {isDesign(workspaceData?.activeWorkspace) && (
                      <nav className="flex rounded-full justify-between content-evenly font-semibold bg-[--hl-xs] p-[--padding-xxs]">
                        {['spec', 'debug', 'test'].map(item => (
                          <NavLink
                            key={item}
                            to={`/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/${item}`}
                            className={({ isActive }) =>
                              `${
                                isActive
                                  ? 'text-[--color-font] bg-[--color-bg]'
                                  : ''
                              } no-underline transition-colors text-center outline-none min-w-[4rem] uppercase text-[--color-font] text-xs px-[--padding-xs] py-[--padding-xxs] rounded-full`
                            }
                          >
                            {item}
                          </NavLink>
                        ))}
                      </nav>
                    )}
                  </Fragment>
                )}
              </div>
              <div className="flex gap-[--padding-sm] items-center justify-end p-2">
                {isLoggedIn() ? (
                  <MenuTrigger>
                    <Button className="px-4 py-1 flex items-center justify-center gap-2 aria-pressed:bg-[--hl-sm] rounded-sm text-[--color-font] hover:bg-[--hl-xs] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all text-sm">
                      <Icon icon="user" />{' '}
                      {`${getFirstName()} ${getLastName()}`}
                    </Button>
                    <Popover className="min-w-max">
                      <Menu
                        onAction={action => {
                          if (action === 'logout') {
                            logout();
                          }

                          if (action === 'account-settings') {
                            window.main.openInBrowser(
                              'https://app.insomnia.rest/app/account/'
                            );
                          }
                        }}
                        className="border select-none text-sm min-w-max border-solid border-[--hl-sm] shadow-lg bg-[--color-bg] py-2 rounded-md overflow-y-auto max-h-[85vh] focus:outline-none"
                      >
                        <Item
                          id="account-settings"
                          className="flex gap-2 px-[--padding-md] aria-selected:font-bold items-center text-[--color-font] h-[--line-height-xs] w-full text-md whitespace-nowrap bg-transparent hover:bg-[--hl-sm] disabled:cursor-not-allowed focus:bg-[--hl-xs] focus:outline-none transition-colors"
                          aria-label="Account settings"
                        >
                          <Icon icon="gear" />
                          <span>Account Settings</span>
                        </Item>
                        <Item
                          id="logout"
                          className="flex gap-2 px-[--padding-md] aria-selected:font-bold items-center text-[--color-font] h-[--line-height-xs] w-full text-md whitespace-nowrap bg-transparent hover:bg-[--hl-sm] disabled:cursor-not-allowed focus:bg-[--hl-xs] focus:outline-none transition-colors"
                          aria-label="logout"
                        >
                          <Icon icon="sign-out" />
                          <span>Logout</span>
                        </Item>
                      </Menu>
                    </Popover>
                  </MenuTrigger>
                ) : (
                    <Fragment>
                  </Fragment>
                )}
              </div>
              {/* /**** ><> ↑ --------- Root Component */}
            </header>
            <div className="[grid-area:Navbar] overflow-hidden">
              <nav className="flex flex-col items-center place-content-stretch gap-[--padding-md] w-full h-full overflow-y-auto py-[--padding-md]">
                {organizations.map(organization => (
                  <TooltipTrigger key={organization._id}>
                    <Link>
                      <NavLink
                        className={({ isActive }) =>
                          `select-none text-[--color-font-surprise] flex-shrink-0 hover:no-underline transition-all duration-150 bg-gradient-to-br box-border from-[#4000BF] to-[#154B62] p-[--padding-sm] font-bold outline-[3px] rounded-md w-[28px] h-[28px] flex items-center justify-center active:outline overflow-hidden outline-offset-[3px] outline ${
                            isActive
                              ? 'outline-[--color-font]'
                              : 'outline-transparent focus:outline-[--hl-md] hover:outline-[--hl-md]'
                          }`
                        }
                        to={`/organization/${organization._id}`}
                      >
                        {isDefaultOrganization(organization) ? (
                          <Icon icon="home" />
                        ) : (
                          getNameInitials(organization.name)
                        )}
                      </NavLink>
                    </Link>
                    <Tooltip
                      placement="right"
                      offset={8}
                      className="border select-none text-sm min-w-max border-solid border-[--hl-sm] shadow-lg bg-[--color-bg] text-[--color-font] px-4 py-2 rounded-md overflow-y-auto max-h-[85vh] focus:outline-none"
                    >
                      <span>{organization.name}</span>
                    </Tooltip>
                  </TooltipTrigger>
                ))}
              </nav>
            </div>
            {/* /**** ><> ↑ --------- Navbar */}
            <Outlet />
            <div className="relative [grid-area:Statusbar] flex items-center justify-between overflow-hidden">
              <TooltipTrigger>
                <Button
                  data-testid="settings-button"
                  className="px-4 py-1 h-full flex items-center justify-center gap-2 aria-pressed:bg-[--hl-sm] text-[--color-font] text-xs hover:bg-[--hl-xs] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all"
                  onPress={showSettingsModal}
                >
                  <Icon icon="gear" /> Preferences
                </Button>
                <Tooltip
                  placement="top"
                  offset={8}
                  className="border flex items-center gap-2 select-none text-sm min-w-max border-solid border-[--hl-sm] shadow-lg bg-[--color-bg] text-[--color-font] px-4 py-2 rounded-md overflow-y-auto max-h-[85vh] focus:outline-none"
                >
                  Preferences
                  <Hotkey
                    keyBindings={
                      settings.hotKeyRegistry.preferences_showGeneral
                    }
                  />
                </Tooltip>
              </TooltipTrigger>
              <Link>

                <a
                  className="flex focus:outline-none focus:underline gap-1 items-center text-xs text-[--color-font] px-[--padding-md]"
                >
                  a 100% local and privacy-focus fork of Insomnia <Icon className="text-white" icon="heart" />
                </a>
              </Link>
            </div>
          </div>
          {/* /**** ><> ↑ --------- Statusbar */}

          <Toast />
        </div>
      </NunjucksEnabledProvider>
      {/* /**** ><> ↑ --------- Toast */}
    </AIProvider>
  );
};

export default Root;
/**** ><> ↑ --------- Export */