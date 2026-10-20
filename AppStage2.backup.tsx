import React, {useEffect, useState} from 'react';
import {
  Alert,
  Image,
  PermissionsAndroid,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import RNFS from 'react-native-fs';
import Geolocation from '@react-native-community/geolocation';
import {
  accelerometer,
  gyroscope,
  setUpdateIntervalForType,
  SensorTypes,
} from 'react-native-sensors';

import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from 'react-native-vision-camera';

type SavedPhoto = {
  name: string;
  path: string;
};

type Tab = 'Camera' | 'Sensors' | 'Gallery' | 'Slideshow';

type LocationData = {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  speed: number | null;
};

type SensorData = {
  x: number;
  y: number;
  z: number;
};

const PHOTOS_DIR = `${RNFS.DocumentDirectoryPath}/CameraPhotos`;

const emptySensor: SensorData = {x: 0, y: 0, z: 0};

const App = () => {
  const device = useCameraDevice('back');
  const photoOutput = usePhotoOutput({});
  const {hasPermission, requestPermission} = useCameraPermission();

  const [activeTab, setActiveTab] = useState<Tab>('Camera');
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [savedPhotos, setSavedPhotos] = useState<SavedPhoto[]>([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [slidePlaying, setSlidePlaying] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [location, setLocation] = useState<LocationData>({
    latitude: null,
    longitude: null,
    altitude: null,
    speed: null,
  });

  const [accelerometerData, setAccelerometerData] =
    useState<SensorData>(emptySensor);

  const [gyroscopeData, setGyroscopeData] =
    useState<SensorData>(emptySensor);

  const [locationError, setLocationError] = useState('');

  const toFileUri = (path: string) =>
    path.startsWith('file://') ? path : `file://${path}`;

  // Load photos saved inside the app.
  const loadPhotos = async () => {
    try {
      await RNFS.mkdir(PHOTOS_DIR);

      const files = await RNFS.readDir(PHOTOS_DIR);

      const photos: SavedPhoto[] = files
        .filter(
          file =>
            file.isFile() && /\.(jpg|jpeg)$/i.test(file.name),
        )
        .sort((a, b) => b.name.localeCompare(a.name))
        .map(file => ({
          name: file.name,
          path: file.path,
        }));

      setSavedPhotos(photos);

      setSlideIndex(current =>
        photos.length === 0 ? 0 : current % photos.length,
      );
    } catch (error) {
      console.error('Load photos error:', error);
      Alert.alert('خطأ', 'تعذّر تحميل الصور المحفوظة.');
    }
  };

  useEffect(() => {
    loadPhotos();
  }, []);

 
  useEffect(() => {
    if (
      activeTab !== 'Slideshow' ||
      !slidePlaying ||
      savedPhotos.length < 2
    ) {
      return;
    }

    const timer = setInterval(() => {
      setSlideIndex(current => (current + 1) % savedPhotos.length);
    }, 1000);

    return () => clearInterval(timer);
  }, [activeTab, slidePlaying, savedPhotos.length]);

  useEffect(() => {
    if (activeTab !== 'Sensors') {
      return;
    }

    let cancelled = false;
    let watchId: number | null = null;

    let accelerometerSubscription:
      | {unsubscribe: () => void}
      | undefined;

    let gyroscopeSubscription:
      | {unsubscribe: () => void}
      | undefined;

    const startSensors = async () => {
      try {
        if (Platform.OS === 'android') {
          const result = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
          ]);

          const granted =
            result[
              PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
            ] === PermissionsAndroid.RESULTS.GRANTED ||
            result[
              PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION
            ] === PermissionsAndroid.RESULTS.GRANTED;

          if (!granted) {
            if (!cancelled) {
              setLocationError(
                'يجب السماح بالوصول إلى الموقع لعرض بياناته.',
              );
            }
            return;
          }
        }

        if (cancelled) {
          return;
        }

        setLocationError('');

        const updateLocation = (position: any) => {
          if (cancelled) {
            return;
          }

          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            altitude: position.coords.altitude,
            speed: position.coords.speed,
          });

          setLocationError('');
        };

        const handleLocationError = (error: any) => {
          if (!cancelled) {
            setLocationError(error.message);
          }
        };

        Geolocation.getCurrentPosition(
          updateLocation,
          handleLocationError,
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 5000,
          },
        );

        watchId = Geolocation.watchPosition(
          updateLocation,
          handleLocationError,
          {
            enableHighAccuracy: true,
            distanceFilter: 0,
            interval: 10000,
            fastestInterval: 10000,
            maximumAge: 0,
          },
        );

        setUpdateIntervalForType(SensorTypes.accelerometer, 500);
        setUpdateIntervalForType(SensorTypes.gyroscope, 500);

        // Accelerometer values are stored separately.
        accelerometerSubscription = accelerometer.subscribe(
          ({x, y, z}) => {
            if (!cancelled) {
              setAccelerometerData({x, y, z});
            }
          },
          error => console.error('Accelerometer error:', error),
        );

        // Gyroscope values are stored separately.
        gyroscopeSubscription = gyroscope.subscribe(
          ({x, y, z}) => {
            if (!cancelled) {
              setGyroscopeData({x, y, z});
            }
          },
          error => console.error('Gyroscope error:', error),
        );
      } catch (error) {
        console.error('Sensor setup error:', error);

        if (!cancelled) {
          setLocationError('تعذّر تشغيل الموقع أو الحساسات.');
        }
      }
    };

    startSensors();

    return () => {
      cancelled = true;

      if (watchId !== null) {
        Geolocation.clearWatch(watchId);
      }

      Geolocation.stopObserving();
      accelerometerSubscription?.unsubscribe();
      gyroscopeSubscription?.unsubscribe();
    };
  }, [activeTab]);

  const askPermission = async () => {
    try {
      await requestPermission();
    } catch (error) {
      console.error('Camera permission error:', error);
      Alert.alert('خطأ', 'تعذّر طلب إذن الكاميرا.');
    }
  };

  const takePhoto = async () => {
    try {
      if (!device) {
        Alert.alert('تنبيه', 'الكاميرا غير متاحة.');
        return;
      }

      const photo = await photoOutput.capturePhotoToFile({}, {});
      setPhotoPath(toFileUri(photo.filePath));
    } catch (error) {
      console.error('Take photo error:', error);
      Alert.alert('خطأ', 'تعذّر التقاط الصورة.');
    }
  };

  const discardPhoto = async () => {
    if (photoPath) {
      try {
        const sourcePath = photoPath.replace(/^file:\/\//, '');

        if (await RNFS.exists(sourcePath)) {
          await RNFS.unlink(sourcePath);
        }
      } catch (error) {
        console.warn('Temporary photo cleanup error:', error);
      }
    }

    setPhotoPath(null);
  };

  const savePhoto = async () => {
    if (!photoPath) {
      return;
    }

    try {
      await RNFS.mkdir(PHOTOS_DIR);

      const sourcePath = photoPath.replace(/^file:\/\//, '');
      const destinationPath = `${PHOTOS_DIR}/photo_${Date.now()}.jpg`;

      await RNFS.moveFile(sourcePath, destinationPath);

      setPhotoPath(null);
      await loadPhotos();

      Alert.alert('تم الحفظ', 'تم حفظ الصورة داخل التطبيق.');
    } catch (error) {
      console.error('Save photo error:', error);
      Alert.alert('خطأ', 'تعذّر حفظ الصورة.');
    }
  };

  const changeTab = (tab: Tab) => {
    setActiveTab(tab);

    if (tab === 'Gallery' || tab === 'Slideshow') {
      loadPhotos();
    }

    if (tab === 'Slideshow') {
      setSlidePlaying(true);
    }
  };

  const refreshGallery = async () => {
    setRefreshing(true);

    try {
      await loadPhotos();
    } finally {
      setRefreshing(false);
    }
  };

  const renderCamera = () => {
    if (!hasPermission) {
      return (
        <View style={styles.center}>
          <Text style={styles.message}>
            اسمح للتطبيق باستخدام الكاميرا.
          </Text>

          <TouchableOpacity
            style={styles.button}
            onPress={askPermission}>
            <Text style={styles.buttonText}>طلب إذن الكاميرا</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!device) {
      return (
        <View style={styles.center}>
          <Text style={styles.message}>لا توجد كاميرا متاحة.</Text>
        </View>
      );
    }

    if (photoPath) {
      return (
        <View style={styles.previewContainer}>
          <Image
            source={{uri: photoPath}}
            style={styles.preview}
            resizeMode="contain"
          />

          <Text style={styles.message}>
            هل تريد حفظ الصورة أم حذفها؟
          </Text>

          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.button, styles.saveButton]}
              onPress={savePhoto}>
              <Text style={styles.buttonText}>حفظ</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.deleteButton]}
              onPress={discardPhoto}>
              <Text style={styles.buttonText}>حذف</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.cameraContainer}>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={activeTab === 'Camera'}
          outputs={[photoOutput]}
        />

        <View style={styles.captureContainer}>
          <TouchableOpacity
            style={styles.captureButton}
            onPress={takePhoto}>
            <View style={styles.captureInner} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderSensors = () => (
    <ScrollView contentContainerStyle={styles.sensorPage}>
      <Text style={styles.title}>بيانات الموقع والحساسات</Text>

      <View style={styles.sensorCard}>
        <Text style={styles.sectionTitle}>الموقع الجغرافي</Text>

        <Text style={styles.sensorText}>
          Latitude: {location.latitude?.toFixed(6) ?? 'بانتظار البيانات...'}
        </Text>

        <Text style={styles.sensorText}>
          Longitude: {location.longitude?.toFixed(6) ?? 'بانتظار البيانات...'}
        </Text>

        <Text style={styles.sensorText}>
          Altitude: {location.altitude?.toFixed(2) ?? 'غير متاح'} m
        </Text>

        <Text style={styles.sensorText}>
          Speed:{' '}
          {location.speed === null || location.speed < 0
            ? 'غير متاح'
            : `${(location.speed * 3.6).toFixed(2)} km/h`}
        </Text>
      </View>

      <View style={styles.sensorCard}>
        <Text style={styles.sectionTitle}>التسارع (Accelerometer)</Text>

        <Text style={styles.sensorText}>
          X: {accelerometerData.x.toFixed(3)}
        </Text>

        <Text style={styles.sensorText}>
          Y: {accelerometerData.y.toFixed(3)}
        </Text>

        <Text style={styles.sensorText}>
          Z: {accelerometerData.z.toFixed(3)}
        </Text>

        <Text style={styles.hint}>
          قيم التسارع تتأثر بحركة الجهاز والجاذبية.
        </Text>
      </View>

      <View style={styles.sensorCard}>
        <Text style={styles.sectionTitle}>الجيروسكوب (Gyroscope)</Text>

        <Text style={styles.sensorText}>
          X: {gyroscopeData.x.toFixed(3)}
        </Text>

        <Text style={styles.sensorText}>
          Y: {gyroscopeData.y.toFixed(3)}
        </Text>

        <Text style={styles.sensorText}>
          Z: {gyroscopeData.z.toFixed(3)}
        </Text>

        <Text style={styles.hint}>
          هذه قيم السرعة الزاوية وليست زوايا اتجاه الجهاز مباشرة.
        </Text>
      </View>

      {locationError ? (
        <Text style={styles.errorText}>{locationError}</Text>
      ) : null}

      <TouchableOpacity
        style={styles.button}
        onPress={() => changeTab('Camera')}>
        <Text style={styles.buttonText}>العودة للكاميرا</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderGallery = () => (
    <View style={styles.page}>
      <View style={styles.headingRow}>
        <Text style={styles.title}>معرض الصور</Text>

        <TouchableOpacity
          style={styles.smallButton}
          onPress={refreshGallery}>
          <Text style={styles.buttonText}>تحديث</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.galleryScroll}
        contentContainerStyle={styles.galleryGrid}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshGallery}
            tintColor="#fff"
            colors={['#16803c']}
            progressBackgroundColor="#222"
          />
        }>
        {savedPhotos.length === 0 ? (
          <Text style={styles.message}>
            لا توجد صور محفوظة حتى الآن.
            {'\n'}اسحب للأسفل لتحديث المعرض.
          </Text>
        ) : (
          savedPhotos.map(photo => (
            <View key={photo.name} style={styles.photoCard}>
              <Image
                source={{uri: toFileUri(photo.path)}}
                style={styles.galleryImage}
                resizeMode="cover"
              />

              <Text style={styles.photoName} numberOfLines={1}>
                {photo.name}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );

  const renderSlideshow = () => {
    const currentPhoto = savedPhotos[slideIndex];

    return (
      <View style={styles.page}>
        <Text style={styles.title}>عرض الصور</Text>

        {currentPhoto ? (
          <>
            <Image
              source={{uri: toFileUri(currentPhoto.path)}}
              style={styles.slideImage}
              resizeMode="contain"
            />

            <Text style={styles.photoName}>{currentPhoto.name}</Text>

            <Text style={styles.message}>
              الصورة {slideIndex + 1} من {savedPhotos.length}
            </Text>

            <View style={styles.buttons}>
              <TouchableOpacity
                style={[
                  styles.button,
                  slidePlaying ? styles.deleteButton : styles.saveButton,
                ]}
                onPress={() => setSlidePlaying(current => !current)}>
                <Text style={styles.buttonText}>
                  {slidePlaying ? 'إيقاف مؤقت' : 'استئناف'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.button}
                onPress={() => {
                  setSlideIndex(current =>
                    savedPhotos.length
                      ? (current + 1) % savedPhotos.length
                      : 0,
                  );
                }}>
                <Text style={styles.buttonText}>الصورة التالية</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.hint}>
              {slidePlaying
                ? 'العرض يتقدم تلقائيًا كل ثانية.'
                : 'العرض متوقف مؤقتًا.'}
            </Text>
          </>
        ) : (
          <Text style={styles.message}>
            احفظ صورًا أولًا حتى تظهر هنا.
          </Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {activeTab === 'Camera' && renderCamera()}
        {activeTab === 'Sensors' && renderSensors()}
        {activeTab === 'Gallery' && renderGallery()}
        {activeTab === 'Slideshow' && renderSlideshow()}
      </View>

      <View style={styles.bottomNav}>
        {(
          [
            ['Camera', 'الكاميرا'],
            ['Sensors', 'الحساسات'],
            ['Gallery', 'المعرض'],
            ['Slideshow', 'عرض الصور'],
          ] as [Tab, string][]
        ).map(([tab, label]) => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.navItem,
              activeTab === tab && styles.activeNavItem,
            ]}
            onPress={() => changeTab(tab)}>
            <Text
              style={[
                styles.navText,
                activeTab === tab && styles.activeNavText,
              ]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#111'},
  content: {flex: 1},
  cameraContainer: {flex: 1, backgroundColor: '#000'},

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#111',
  },

  page: {flex: 1, padding: 16, alignItems: 'center'},
  galleryScroll: {width: '100%', flex: 1},

  sensorPage: {padding: 16, alignItems: 'stretch'},

  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    marginVertical: 16,
  },

  headingRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  message: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginVertical: 16,
  },

  captureContainer: {
    position: 'absolute',
    bottom: 30,
    alignSelf: 'center',
  },

  captureButton: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 5,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },

  captureInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
  },

  previewContainer: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111',
  },

  preview: {width: '100%', flex: 1},

  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 12,
  },

  button: {
    backgroundColor: '#333',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginVertical: 8,
  },

  smallButton: {backgroundColor: '#333', padding: 10, borderRadius: 8},
  saveButton: {backgroundColor: '#16803c'},
  deleteButton: {backgroundColor: '#c62828'},

  buttonText: {color: '#fff', fontSize: 15, fontWeight: 'bold'},

  galleryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignContent: 'flex-start',
    gap: 12,
    paddingBottom: 20,
    flexGrow: 1,
  },

  photoCard: {
    width: '46%',
    backgroundColor: '#222',
    padding: 6,
    borderRadius: 10,
  },

  galleryImage: {width: '100%', height: 150, borderRadius: 6},

  photoName: {
    color: '#fff',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
  },

  slideImage: {width: '100%', flex: 1},

  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#202020',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#444',
  },

  navItem: {flex: 1, alignItems: 'center', paddingVertical: 12},
  activeNavItem: {backgroundColor: '#333', borderRadius: 8},
  navText: {color: '#bbb', fontSize: 12},
  activeNavText: {color: '#fff', fontWeight: 'bold'},

  sensorCard: {
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
  },

  sectionTitle: {
    color: '#8ecae6',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },

  sensorText: {color: '#fff', fontSize: 16, marginVertical: 5},
  hint: {color: '#aaa', fontSize: 12, marginTop: 8},
  errorText: {color: '#ff7777', fontSize: 14, marginVertical: 10},
});

export default App;
