import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth';
import { ref, update, serverTimestamp } from 'firebase/database';
import { auth, database } from '../lib/firebase';
import { loadUserNickname, saveUserNickname } from '../lib/menuApi';
import {
  createWorkspace,
  loadWorkspace,
  registerKiosk,
  deleteBranchToWorkspace,
} from '../lib/workspaceApi';

const AuthContext = createContext(null);

const AUTH_KEY = 'aiops-user';
const AI_SHIFT_HANDOFF_COMPLETED = 'shiftHandoffCompleted';
const AI_LIVEOPS_INITIAL_COMPLETED = 'liveOpsInitialRunCompleted';
const AI_LIVEOPS_NEXT_RUNTIME = 'nextLiveOpsRunTime';
const AI_FEED_ITEMS = 'aiFeedItems';

function authErrorMessage(error, action = 'sign in') {
  const messages = {
    'auth/email-already-in-use': 'This email already has an account. Choose Log in instead.',
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/weak-password': 'Use a stronger password with at least 6 characters.',
    'auth/operation-not-allowed': 'Email/password sign-in is disabled in Firebase Authentication.',
    'auth/unauthorized-domain': 'This website is not authorized in Firebase Authentication.',
    'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow popups and try again.',
    'auth/popup-closed-by-user': 'The Google sign-in window was closed before completion.',
    'auth/network-request-failed': 'Network connection failed. Check your connection and try again.',
  };
  return messages[error?.code] || error?.message || `Could not ${action}. Please try again.`;
}

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error('Failed to set persistence:', error);
});

function detectProvider(firebaseUser) {
  if (!firebaseUser) return 'password';
  const providerData = firebaseUser.providerData || [];
  const firstProvider = providerData[0]?.providerId;
  if (firstProvider === 'google.com') return 'google';
  if (firstProvider === 'password') return 'password';
  return firstProvider || 'password';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState('');
  const [nicknameLoaded, setNicknameLoaded] = useState(false);
  const [workspace, setWorkspace] = useState(null);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((firebaseUser) => {
      if (firebaseUser) {
        setNicknameLoaded(false);
        setWorkspaceLoaded(false);
        setNickname('');
        const userData = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || '',
          photoURL: firebaseUser.photoURL || '',
          provider: detectProvider(firebaseUser),
        };
        setUser(userData);
        localStorage.setItem(AUTH_KEY, JSON.stringify(userData));

        Promise.all([
          loadUserNickname(firebaseUser.uid),
          loadWorkspace(firebaseUser.uid),
        ])
          .then(([userNickname, currentWorkspace]) => {
            setNickname(userNickname || '');
            setWorkspace(currentWorkspace);
            if (currentWorkspace?.companyId) {
              update(ref(database, `${currentWorkspace.companyId}/users/${firebaseUser.uid}`), {
                email: firebaseUser.email || '',
                displayName: firebaseUser.displayName || '',
                photoURL: firebaseUser.photoURL || '',
                provider: detectProvider(firebaseUser),
                updatedAt: serverTimestamp(),
              }).catch((err) => console.error('Failed to update company user profile:', err));
            }
          })
          .catch((err) => {
            console.error('Error loading account workspace:', err);
            setWorkspace(null);
          })
          .finally(() => {
            setNicknameLoaded(true);
            setWorkspaceLoaded(true);
            setInitialLoading(false);
          });
      } else {
        setUser(null);
        setNickname('');
        setNicknameLoaded(false);
        setWorkspace(null);
        setWorkspaceLoaded(true);
        localStorage.removeItem(AUTH_KEY);
        sessionStorage.removeItem(AI_SHIFT_HANDOFF_COMPLETED);
        sessionStorage.removeItem(AI_LIVEOPS_INITIAL_COMPLETED);
        sessionStorage.removeItem(AI_LIVEOPS_NEXT_RUNTIME);
        sessionStorage.removeItem(AI_FEED_ITEMS);

        setInitialLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const login = useCallback(async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      sessionStorage.removeItem(AI_SHIFT_HANDOFF_COMPLETED);
      sessionStorage.removeItem(AI_LIVEOPS_INITIAL_COMPLETED);
      sessionStorage.removeItem(AI_LIVEOPS_NEXT_RUNTIME);
      sessionStorage.removeItem(AI_FEED_ITEMS);
      await signInWithEmailAndPassword(auth, email, password);
      return true;
    } catch (err) {
      setError(authErrorMessage(err));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      return true;
    } catch (err) {
      setError(authErrorMessage(err, 'create the account'));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithGoogle = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
      sessionStorage.removeItem(AI_SHIFT_HANDOFF_COMPLETED);
      sessionStorage.removeItem(AI_LIVEOPS_INITIAL_COMPLETED);
      sessionStorage.removeItem(AI_LIVEOPS_NEXT_RUNTIME);
      sessionStorage.removeItem(AI_FEED_ITEMS);
      return true;
    } catch (err) {
      setError(authErrorMessage(err, 'sign in with Google'));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const completeWorkspace = useCallback(
    async (setup) => {
      if (!auth.currentUser) throw new Error('No user is currently signed in.');
      setLoading(true);
      setError(null);
      try {
        const nextWorkspace = await createWorkspace({
          uid: auth.currentUser.uid,
          email: auth.currentUser.email,
          displayName: auth.currentUser.displayName,
          photoURL: auth.currentUser.photoURL,
          provider: detectProvider(auth.currentUser),
          ...setup,
        });
        setWorkspace(nextWorkspace);
        return nextWorkspace;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const registerKioskForCurrentUser = useCallback(
    async (kioskName, kioskUid, targetBranchId) => {
      if (!auth.currentUser) throw new Error('No user is currently signed in.');
      if (!workspace?.branchId) throw new Error('No workspace is set up yet.');
      // The branch the kiosk is registered to must match the page the operator is
      // viewing (e.g. branch 2), NOT the account's default branch (branch 1).
      const branchToRegister = targetBranchId || workspace.branchId;
      await registerKiosk(auth.currentUser.uid, branchToRegister, kioskName, kioskUid);
    },
    [workspace?.branchId]
  );

  const setWorkspaceFromProps = useCallback((nextWorkspace) => {
    setWorkspace((current) => ({ ...(current || {}), ...(nextWorkspace || {}) }));
  }, []);

  const updateNickname = useCallback(
    async (newNickname) => {
      if (!user?.uid) return;
      try {
        await saveUserNickname(user.uid, user.email, newNickname);
        setNickname(newNickname);
        return true;
      } catch (err) {
        setError(err.message);
        return false;
      }
    },
    [user]
  );

  const logout = useCallback(async () => {
    setLoading(true);
    try {
      sessionStorage.removeItem(AI_SHIFT_HANDOFF_COMPLETED);
      sessionStorage.removeItem(AI_LIVEOPS_INITIAL_COMPLETED);
      sessionStorage.removeItem(AI_LIVEOPS_NEXT_RUNTIME);
      sessionStorage.removeItem(AI_FEED_ITEMS);
      await signOut(auth);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const forgotPassword = useCallback(async (email) => {
    setLoading(true);
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const changePassword = useCallback(async (newPassword) => {
    if (!auth.currentUser) {
      setError('No user is currently signed in');
      return false;
    }
    setLoading(true);
    setError(null);
    try {
      await updatePassword(auth.currentUser, newPassword);
      return true;
    } catch (err) {
      if (err.code === 'auth/requires-recent-login') {
        setError('Please log out and log back in, then try changing your password again.');
      } else {
        setError(err.message);
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Sensitive operation: re-authenticates the user with their password, then
   * permanently deletes the given branch. Returns the updated workspace.
   */
  const deleteBranchWithPassword = useCallback(
    async (branchId, password) => {
      if (!auth.currentUser) throw new Error('No user is currently signed in.');
      const email = auth.currentUser.email;
      if (!email) throw new Error('This account has no email to re-authenticate with.');
      setLoading(true);
      setError(null);
      try {
        await reauthenticateWithCredential(
          auth.currentUser,
          EmailAuthProvider.credential(email, password)
        );
        const updated = await deleteBranchToWorkspace(auth.currentUser.uid, branchId);
        setWorkspaceFromProps(updated);
        return updated;
      } catch (err) {
        if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
          setError('The password is incorrect.');
        } else if (err.code === 'auth/too-many-requests') {
          setError('Too many attempts. Please wait a moment and try again.');
        } else {
          setError(err.message);
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [setWorkspaceFromProps]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        nickname,
        nicknameLoaded,
        workspace,
        workspaceLoaded,
        updateNickname,
        changePassword,
        login,
        register,
        loginWithGoogle,
        completeWorkspace,
        registerKioskForCurrentUser,
        deleteBranchWithPassword,
        setWorkspaceFromProps,
        logout,
        forgotPassword,
        isAuthenticated: !!user,
        loading,
        initialLoading,
        error,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
