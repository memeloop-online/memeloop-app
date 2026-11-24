import 'expo';
import 'react-native-get-random-values';
import { installMobileAbortMethods } from './nativeAbort';
import { installMobilePromiseCapabilities } from './nativePromise';

installMobileAbortMethods();
installMobilePromiseCapabilities();
