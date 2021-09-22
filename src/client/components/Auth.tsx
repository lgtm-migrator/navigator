import React from 'react';
import {
  AsyncProcess,
  AsyncProcessError,
  AsyncProcessStatus,
  AsyncProcessSuccess,
} from '../utils/AsyncProcess';

import { BrowserAuth } from '../utils/BrowserAuth';
import { AuthService, AuthError, TokenInfo } from '../utils/AuthService';
import UserModel, { UserProfile } from '../utils/UserModel';

/**
 * Holds the current authentication information
 */
export interface AuthInfo {
  token: string;
  tokenInfo: TokenInfo;
}

/**
 * Auth state -
 *
 * Follows the state machine model, in which we have a status enum, which is
 * used as the status field for a "state" interface. This allows us to implement
 * run-time type narrowing, based on the value of the "status" enum, aka
 * discriminated union.
 *
 * NONE - auth state unknown
 * AUTHENTICATED - token found in browser, determined to be valid
 * UNAUTHENTICATED - no token found in browser, or token is invalid.
 */
export enum AuthenticationStatus {
  NONE = 'NONE',
  AUTHENTICATED = 'AUTHENTICATED',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
}

export interface AuthenticationStatusBase {
  status: AuthenticationStatus;
}

export interface AuthenticationStateNone extends AuthenticationStatusBase {
  status: AuthenticationStatus.NONE;
}

export interface AuthenticationStateAuthenticated
  extends AuthenticationStatusBase {
  status: AuthenticationStatus.AUTHENTICATED;
  authInfo: AuthInfo;
  userProfile: UserProfile;
}

export interface AuthenticationStateUnauthenticated
  extends AuthenticationStatusBase {
  status: AuthenticationStatus.UNAUTHENTICATED;
}

export type AuthenticationState =
  | AuthenticationStateNone
  | AuthenticationStateAuthenticated
  | AuthenticationStateUnauthenticated;

export type AuthState = AsyncProcess<AuthenticationState>;

// Context

/**
 * The AuthContext is the basis for propagating auth state
 * throughout the app.
 */

export const AuthContext = React.createContext<AuthState>({
  status: AsyncProcessStatus.NONE,
});

// Auth Wrapper Component

export interface AuthWrapperProps {}

interface AuthWrapperState {
  authState: AuthState;
}

/**
 * Wraps a component tree, ensuring that authentication status is
 * resolved and placed into the AuthContext. The auth state in the
 * context can then be used by descendants to do "the right thing".
 * In this app, the right thing is to show an error message if
 * there is lack of authentication (no token, invalid token), and to
 * proceed otherwise.
 *
 * Also note that the auth state is itself wrapped into an AsyncProcess,
 * which ensures that descendants can handle the async behavior of
 * determining the auth state (because we may need to call the auth service),
 * which includes any errors encountered.
 */
export default class AuthWrapper extends React.Component<
  AuthWrapperProps,
  AuthWrapperState
> {
  constructor(props: AuthWrapperProps) {
    super(props);
    this.state = {
      authState: {
        status: AsyncProcessStatus.NONE,
      },
    };
  }

  componentDidMount() {
    this.fetchTokenInfo();
  }

  async fetchUserProfile(token: string, username: string) {
    const userModel = new UserModel(token);
    const userProfile = await userModel.fetchProfile(username);
    // TODO: should sort out the behavior of fetchProfile...
    if (userProfile === null) {
      throw new Error(`User not found: ${username}`);
    }
    return userProfile;
  }

  async fetchTokenInfo() {
    const token = BrowserAuth.getToken();

    function unauthenticatedState(): AsyncProcessSuccess<AuthenticationStateUnauthenticated> {
      return {
        status: AsyncProcessStatus.SUCCESS,
        value: {
          status: AuthenticationStatus.UNAUTHENTICATED,
        },
      };
    }

    function errorState(message: string): AsyncProcessError {
      return {
        status: AsyncProcessStatus.ERROR,
        message,
      };
    }

    if (token === null) {
      this.setState({ authState: unauthenticatedState() });
      return;
    }

    const auth = new AuthService(token);

    try {
      const tokenInfo = await auth.getTokenInfo();
      if (tokenInfo === null) {
        this.setState({ authState: unauthenticatedState() });
      } else {
        const userProfile = await this.fetchUserProfile(token, tokenInfo.user);
        this.setState({
          authState: {
            status: AsyncProcessStatus.SUCCESS,
            value: {
              status: AuthenticationStatus.AUTHENTICATED,
              authInfo: {
                token,
                tokenInfo,
              },
              userProfile,
            },
          },
        });
      }
    } catch (ex) {
      if (ex instanceof AuthError) {
        switch (ex.error.appcode) {
          case 10020:
            this.setState({ authState: unauthenticatedState() });
            break;
          default:
            this.setState({ authState: errorState(ex.error.message) });
        }
      } else if (ex instanceof Error) {
        this.setState({ authState: errorState(ex.message) });
      } else {
        this.setState({ authState: errorState('Unknown Error') });
      }
    }
  }

  render() {
    return (
      <AuthContext.Provider value={this.state.authState}>
        {this.props.children}
      </AuthContext.Provider>
    );
  }
}