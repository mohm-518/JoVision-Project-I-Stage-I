
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Alert,
  Image,
  PermissionsAndroid,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
  useVideoOutput,
} from 'react-native-vision-camera';

import RNFS from 'react-native-fs';
import Geolocation from '@react-native-community/geolocation';
import {
  accelerometer,
  gyroscope,
  setUpdateIntervalForType,
  SensorTypes,
} from 'react-native-sensors';

import {VideoView, useVideoPlayer} from 'react-native-video';

type MediaItem = {
  name: string;
  path: string;
  type: 'image' | 'video';
};

type Tab = 'Camera' | 'Sensors' | 'Gallery' | 'Slideshow';

const PHOTOS_DIR = `${RNFS.DocumentDirectoryPath}/CameraPhotos`;

const SPEED_X = 8;
const SPEED_Y = 1;

const isVideo = (name: string) => /\.mp4$/i.test(name);

const makeFileName = (extension: string) =>
  `moh518_${new Date().toISOString().replace(/:/g, '-')}.${extension}`;

const getUri = (path: string) =>
  path.startsWith('file://') ? path : `file://${path}`;

const App = () => {
  const [activeTab, setActiveTab] = useState<Tab>('Camera');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [cameraPosition, setCameraPosition] = useState<'back' | 'front'>(
    'back',
  );
  const [captureMode, setCaptureMode] = useState<'photo' | 'video'>('photo');
  const [isRecording, setIsRecording] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<'image' | 'video'>('image');

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [speed, setSpeed] = useState(0);
  const [accel, setAccel] = useState({x: 0, y: 0, z: 0});
  const [gyro, setGyro] = useState({x: 0, y: 0, z: 0});

  const recorderRef = useRef<any>(null);
  const mountedRef = useRef(true);

  const device = useCameraDevice(cameraPosition);
  const {hasPermission, requestPermission} = useCameraPermission();

  const photoOutput = usePhotoOutput();
  const videoOutput = useVideoOutput();

  const ensureDirectory = useCallback(async () => {
    const exists = await RNFS.exists(PHOTOS_DIR);
    if (!exists) {
      await RNFS.mkdir(PHOTOS_DIR);
    }
  }, []);

  const loadMedia = useCallback(async () => {
    try {
      await ensureDirectory();

      const files = await RNFS.readDir(PHOTOS_DIR);

      // تحديد نوع الملف صراحةً يحل خطأ:
      // Type 'string' is not assignable to '"video" | "image"'.
      const items: MediaItem[] = files
        .filter(
          file =>
            file.isFile() && /\.(jpg|jpeg|mp4)$/i.test(file.name),
        )
        .map(
          (file): MediaItem => ({
            name: file.name,
            path: file.path,
            type: isVideo(file.name) ? 'video' : 'image',
          }),
        )
        .sort((a, b) => b.name.localeCompare(a.name));

      if (!mountedRef.current) {
        return;
      }

      setMedia(items);
      setSlideIndex(index => (items.length ? index % items.length : 0));

      setViewerIndex(index => {
        if (index === null || items.length === 0) {
          return null;
        }

        const previous = media[index];

        if (!previous) {
          return null;
        }

        const updatedIndex = items.findIndex(
          item => item.path === previous.path,
        );

        return updatedIndex < 0 ? null : updatedIndex;
      });
    } catch (error) {
      console.error('Load media error:', error);
      Alert.alert('خطأ', 'تعذّر تحميل الملفات المحفوظة.');
    }
  }, [ensureDirectory, media]);

  useEffect(() => {
    mountedRef.current = true;
    loadMedia();

    return () => {
      mountedRef.current = false;
    };
  }, [loadMedia]);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const requestLocationPermission = async () => {
      try {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
      } catch (error) {
        console.warn('Location permission error:', error);
      }
    };

    requestLocationPermission();
  }, []);

  useEffect(() => {
    setUpdateIntervalForType(SensorTypes.accelerometer, 500);
    setUpdateIntervalForType(SensorTypes.gyroscope, 500);

    const accelSubscription = accelerometer.subscribe({
      next: ({x, y, z}) => setAccel({x, y, z}),
      error: error => console.warn('Accelerometer error:', error),
    });

    const gyroSubscription = gyroscope.subscribe({
      next: ({x, y, z}) => setGyro({x, y, z}),
      error: error => console.warn('Gyroscope error:', error),
    });

    const watchId = Geolocation.watchPosition(
      position => {
        const currentSpeed = position.coords.speed;

        if (currentSpeed !== null && currentSpeed >= 0) {
          // GPS speed is metres/second; convert to km/h.
          setSpeed(currentSpeed * 3.6);
        }
      },
      error => console.warn('Location error:', error),
      {
        enableHighAccuracy: true,
        distanceFilter: 1,
        interval: 1000,
        fastestInterval: 1000,
      } as any,
    );

    return () => {
      accelSubscription.unsubscribe();
      gyroSubscription.unsubscribe();
      Geolocation.clearWatch(watchId);
    };
  }, []);

  const saveMedia = async (sourcePath: string, extension: string) => {
    await ensureDirectory();

    const destination = `${PHOTOS_DIR}/${makeFileName(extension)}`;

    await RNFS.moveFile(sourcePath, destination);
    await loadMedia();

    return destination;
  };

  const takePhoto = async () => {
    try {
      const result = await photoOutput.capturePhotoToFile({}, {});
      const sourcePath =
        typeof result === 'string'
          ? result
          : (result as any)?.path ?? (result as any)?.filePath;

      if (!sourcePath) {
        throw new Error('لم يتم إرجاع مسار الصورة.');
      }

      const savedPath = await saveMedia(sourcePath, 'jpg');

      setPreviewPath(savedPath);
      setPreviewType('image');

      Alert.alert('تم', 'تم حفظ الصورة بنجاح.');
    } catch (error) {
      console.error('Take photo error:', error);
      Alert.alert('خطأ', 'تعذّر التقاط الصورة. تحقق من صلاحيات الكاميرا.');
    }
  };

  const startRecording = async () => {
    try {
      await ensureDirectory();

      const destination = `${PHOTOS_DIR}/${makeFileName('mp4')}`;

      const recorder = await videoOutput.createRecorder({
        filePath: destination,
      });

      recorderRef.current = recorder;

      recorder.startRecording(
        async () => {
          recorderRef.current = null;
          setIsRecording(false);
          await loadMedia();

          setPreviewPath(destination);
          setPreviewType('video');

          Alert.alert('تم', 'تم حفظ الفيديو بنجاح.');
        },
        (error: unknown) => {
          console.error('Recording error:', error);
          recorderRef.current = null;
          setIsRecording(false);
          Alert.alert('خطأ', 'تعذّر تسجيل الفيديو.');
        },
      );

      setIsRecording(true);
    } catch (error) {
      console.error('Start recording error:', error);
      setIsRecording(false);
      Alert.alert('خطأ', 'تعذّر بدء تسجيل الفيديو.');
    }
  };

  const stopRecording = async () => {
    try {
      const recorder = recorderRef.current;

      if (recorder) {
        await recorder.stopRecording();
      }
    } catch (error) {
      console.error('Stop recording error:', error);
      setIsRecording(false);
      Alert.alert('خطأ', 'تعذّر إيقاف التسجيل بشكل صحيح.');
    }
  };

  const flipCamera = () => {
    if (isRecording) {
      Alert.alert('تنبيه', 'أوقف تسجيل الفيديو قبل تبديل الكاميرا.');
      return;
    }

    setCameraPosition(current => (current === 'back' ? 'front' : 'back'));
  };

  const changeCaptureMode = (mode: 'photo' | 'video') => {
    if (isRecording) {
      Alert.alert('تنبيه', 'أوقف التسجيل قبل تغيير وضع التصوير.');
      return;
    }

    setCaptureMode(mode);
  };

  const discardPreview = () => {
    setPreviewPath(null);
  };

  const keepPreview = async () => {
    setPreviewPath(null);
    await loadMedia();
    setActiveTab('Gallery');
  };

  const deleteMedia = (item: MediaItem) => {
    Alert.alert('حذف الملف', `هل تريد حذف ${item.name}؟`, [
      {text: 'إلغاء', style: 'cancel'},
      {
        text: 'حذف',
        style: 'destructive',
        onPress: async () => {
          try {
            await RNFS.unlink(item.path);
            setViewerIndex(null);
            await loadMedia();
          } catch (error) {
            console.error('Delete media error:', error);
            Alert.alert('خطأ', 'تعذّر حذف الملف.');
          }
        },
      },
    ]);
  };

  const beginRename = (item: MediaItem) => {
    setRenamePath(item.path);
    setRenameValue(item.name);
  };

  const confirmRename = async () => {
    if (!renamePath) {
      return;
    }

    const cleanName = renameValue.trim();

    if (!cleanName || /[\\/]/.test(cleanName)) {
      Alert.alert('اسم غير صالح', 'أدخل اسم ملف صالحاً بدون / أو \\.');
      return;
    }

    const extension = cleanName.toLowerCase().endsWith('.mp4')
      ? '.mp4'
      : cleanName.toLowerCase().endsWith('.jpg') ||
          cleanName.toLowerCase().endsWith('.jpeg')
        ? ''
        : isVideo(renamePath)
          ? '.mp4'
          : '.jpg';

    const finalName = extension ? cleanName : `${cleanName}.jpg`;
    const destination = `${PHOTOS_DIR}/${finalName}`;

    try {
      if (await RNFS.exists(destination)) {
        Alert.alert('الملف موجود', 'يوجد ملف آخر بهذا الاسم.');
        return;
      }

      await RNFS.moveFile(renamePath, destination);
      setRenamePath(null);
      setRenameValue('');
      await loadMedia();
    } catch (error) {
      console.error('Rename media error:', error);
      Alert.alert('خطأ', 'تعذّرت إعادة تسمية الملف.');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadMedia();
    setRefreshing(false);
  };

  const openViewer = (item: MediaItem) => {
    const index = media.findIndex(mediaItem => mediaItem.path === item.path);

    if (index >= 0) {
      setViewerIndex(index);
    }
  };

  const closeViewer = () => setViewerIndex(null);

  const showNextMedia = () => {
    if (media.length === 0 || viewerIndex === null) {
      return;
    }

    setViewerIndex(index => ((index ?? 0) + 1) % media.length);
  };

  const showPreviousMedia = () => {
    if (media.length === 0 || viewerIndex === null) {
      return;
    }

    setViewerIndex(index =>
      ((index ?? 0) - 1 + media.length) % media.length,
    );
  };

  const orientation = (() => {
    const {x, y} = accel;

    if (Math.abs(x) > Math.abs(y)) {
      return x > 0 ? 'أفقي - يمين' : 'أفقي - يسار';
    }

    return y < 0 ? 'عمودي' : 'مقلوب رأساً على عقب';
  })();

  const activity = (() => {
    if (speed > SPEED_X) {
      return '🚗 سيارة';
    }

    if (speed > SPEED_Y) {
      return '🚶 مشي';
    }

    return '🪑 جلوس أو سكون';
  })();

  // The viewer is shown outside the bottom-tab interface.
  if (viewerIndex !== null && media[viewerIndex]) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.viewerHeader}>
          <Pressable style={styles.smallButton} onPress={closeViewer}>
            <Text style={styles.buttonText}>رجوع</Text>
          </Pressable>
          <Text numberOfLines={1} style={styles.viewerTitle}>
            {media[viewerIndex].name}
          </Text>
        </View>

        <View style={styles.viewerContent}>
          {media[viewerIndex].type === 'image' ? (
            <Image
              source={{uri: getUri(media[viewerIndex].path)}}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          ) : (
            <VideoPlayerPanel path={media[viewerIndex].path} />
          )}
        </View>

        <View style={styles.viewerControls}>
          <Pressable style={styles.button} onPress={showPreviousMedia}>
            <Text style={styles.buttonText}>السابق</Text>
          </Pressable>
          <Pressable
            style={styles.button}
            onPress={() => beginRename(media[viewerIndex])}>
            <Text style={styles.buttonText}>إعادة تسمية</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.deleteButton]}
            onPress={() => deleteMedia(media[viewerIndex])}>
            <Text style={styles.buttonText}>حذف</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={showNextMedia}>
            <Text style={styles.buttonText}>التالي</Text>
          </Pressable>
        </View>

        {renamePath !== null && (
          <View style={styles.renamePanel}>
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              style={styles.input}
              placeholder="اسم الملف"
              placeholderTextColor="#888"
              autoCapitalize="none"
            />
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={confirmRename}>
                <Text style={styles.buttonText}>حفظ الاسم</Text>
              </Pressable>
              <Pressable
                style={styles.smallButton}
                onPress={() => setRenamePath(null)}>
                <Text style={styles.buttonText}>إلغاء</Text>
              </Pressable>
            </View>
          </View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.appTitle}>JoVision - Project I</Text>

      {previewPath !== null ? (
        <View style={styles.previewContainer}>
          <Text style={styles.sectionTitle}>معاينة الملف</Text>

          {previewType === 'image' ? (
            <Image
              source={{uri: getUri(previewPath)}}
              style={styles.previewImage}
              resizeMode="contain"
            />
          ) : (
            <VideoPlayerPanel path={previewPath} />
          )}

          <View style={styles.row}>
            <Pressable style={styles.button} onPress={keepPreview}>
              <Text style={styles.buttonText}>الاحتفاظ والانتقال للمعرض</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.deleteButton]}
              onPress={discardPreview}>
              <Text style={styles.buttonText}>إغلاق المعاينة</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.screenContent}>
            {activeTab === 'Camera' && (
              <ScrollView contentContainerStyle={styles.contentPadding}>
                <Text style={styles.sectionTitle}>الكاميرا</Text>

                {!hasPermission ? (
                  <View style={styles.centerBox}>
                    <Text style={styles.infoText}>
                      يلزم السماح باستخدام الكاميرا.
                    </Text>
                    <Pressable
                      style={styles.button}
                      onPress={requestPermission}>
                      <Text style={styles.buttonText}>طلب الإذن</Text>
                    </Pressable>
                  </View>
                ) : !device ? (
                  <Text style={styles.infoText}>
                    لم يتم العثور على كاميرا على الجهاز.
                  </Text>
                ) : (
                  <>
                    <View style={styles.cameraContainer}>
                      <Camera
                        style={StyleSheet.absoluteFill}
                        device={device}
                        isActive={activeTab === 'Camera'}
                        outputs={[photoOutput, videoOutput]}
                      />
                    </View>

                    <View style={styles.row}>
                      <Pressable
                        style={[
                          styles.button,
                          captureMode === 'photo' && styles.activeButton,
                        ]}
                        onPress={() => changeCaptureMode('photo')}>
                        <Text style={styles.buttonText}>تصوير صورة</Text>
                      </Pressable>

                      <Pressable
                        style={[
                          styles.button,
                          captureMode === 'video' && styles.activeButton,
                        ]}
                        onPress={() => changeCaptureMode('video')}>
                        <Text style={styles.buttonText}>تصوير فيديو</Text>
                      </Pressable>

                      <Pressable style={styles.button} onPress={flipCamera}>
                        <Text style={styles.buttonText}>تبديل الكاميرا</Text>
                      </Pressable>
                    </View>

                    <Pressable
                      style={[
                        styles.captureButton,
                        isRecording && styles.recordingButton,
                      ]}
                      disabled={!hasPermission}
                      onPress={
                        captureMode === 'photo'
                          ? takePhoto
                          : isRecording
                            ? stopRecording
                            : startRecording
                      }>
                      <Text style={styles.captureButtonText}>
                        {captureMode === 'photo'
                          ? '📸 التقاط صورة'
                          : isRecording
                            ? '⏹ إيقاف التسجيل'
                            : '🔴 بدء تسجيل الفيديو'}
                      </Text>
                    </Pressable>

                    {isRecording && (
                      <Text style={styles.recordingLabel}>
                        ● جارٍ تسجيل الفيديو...
                      </Text>
                    )}
                  </>
                )}
              </ScrollView>
            )}

            {activeTab === 'Sensors' && (
              <ScrollView contentContainerStyle={styles.contentPadding}>
                <Text style={styles.sectionTitle}>Sensors</Text>

                <View style={styles.infoCard}>
                  <Text style={styles.infoTitle}>الحركة التقريبية</Text>
                  <Text style={styles.infoText}>{activity}</Text>
                  <Text style={styles.infoText}>
                    السرعة: {speed.toFixed(1)} كم/ساعة
                  </Text>
                  <Text style={styles.mutedText}>
                    قد تظهر السرعة صفراً عندما لا تتوفر قراءة GPS مناسبة.
                  </Text>
                </View>

                <View style={styles.infoCard}>
                  <Text style={styles.infoTitle}>اتجاه الجهاز</Text>
                  <Text style={styles.orientationText}>{orientation}</Text>
                  <Text style={styles.infoText}>
                    Accelerometer: X {accel.x.toFixed(2)} | Y{' '}
                    {accel.y.toFixed(2)} | Z {accel.z.toFixed(2)}
                  </Text>
                  <Text style={styles.infoText}>
                    Gyroscope: X {gyro.x.toFixed(2)} | Y {gyro.y.toFixed(2)} |
                    Z {gyro.z.toFixed(2)}
                  </Text>
                </View>
              </ScrollView>
            )}

            {activeTab === 'Gallery' && (
              <ScrollView
                contentContainerStyle={styles.contentPadding}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={onRefresh}
                  />
                }>
                <Text style={styles.sectionTitle}>المعرض</Text>
                <Text style={styles.mutedText}>
                  اسحب للأسفل لتحديث قائمة الملفات.
                </Text>

                {media.length === 0 ? (
                  <Text style={styles.infoText}>لا توجد ملفات محفوظة بعد.</Text>
                ) : (
                  media.map(item => (
                    <View key={item.path} style={styles.mediaRow}>
                      {item.type === 'image' ? (
                        <Image
                          source={{uri: getUri(item.path)}}
                          style={styles.thumbnail}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.videoThumbnail}>
                          <Text style={styles.videoIcon}>▶</Text>
                        </View>
                      )}

                      <Pressable
                        style={styles.mediaDetails}
                        onPress={() => openViewer(item)}>
                        <Text numberOfLines={2} style={styles.mediaName}>
                          {item.name}
                        </Text>
                        <Text style={styles.mutedText}>
                          {item.type === 'video' ? 'فيديو' : 'صورة'}
                        </Text>
                      </Pressable>

                      <View style={styles.mediaActions}>
                        <Pressable
                          style={styles.smallButton}
                          onPress={() => beginRename(item)}>
                          <Text style={styles.buttonText}>تسمية</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.smallButton, styles.deleteButton]}
                          onPress={() => deleteMedia(item)}>
                          <Text style={styles.buttonText}>حذف</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}

                {renamePath !== null && (
                  <View style={styles.renamePanel}>
                    <Text style={styles.infoTitle}>إعادة تسمية الملف</Text>
                    <TextInput
                      value={renameValue}
                      onChangeText={setRenameValue}
                      style={styles.input}
                      placeholder="اسم الملف"
                      placeholderTextColor="#888"
                      autoCapitalize="none"
                    />
                    <View style={styles.row}>
                      <Pressable style={styles.button} onPress={confirmRename}>
                        <Text style={styles.buttonText}>حفظ</Text>
                      </Pressable>
                      <Pressable
                        style={styles.smallButton}
                        onPress={() => setRenamePath(null)}>
                        <Text style={styles.buttonText}>إلغاء</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </ScrollView>
            )}

            {activeTab === 'Slideshow' && (
              <View style={styles.slideshowContainer}>
                <Text style={styles.sectionTitle}>Slideshow</Text>

                {media.length === 0 ? (
                  <Text style={styles.infoText}>لا توجد صور أو فيديوهات.</Text>
                ) : (
                  <>
                    {media[slideIndex]?.type === 'image' ? (
                      <Pressable
                        style={styles.slideshowMedia}
                        onPress={() => openViewer(media[slideIndex])}>
                        <Image
                          source={{uri: getUri(media[slideIndex].path)}}
                          style={styles.slideshowImage}
                          resizeMode="contain"
                        />
                      </Pressable>
                    ) : (
                      <Pressable
                        style={styles.slideshowMedia}
                        onPress={() => openViewer(media[slideIndex])}>
                        <View style={styles.slideshowVideo}>
                          <Text style={styles.videoIcon}>▶</Text>
                          <Text style={styles.infoText}>
                            اضغط لفتح الفيديو
                          </Text>
                        </View>
                      </Pressable>
                    )}

                    <Text style={styles.mediaName}>
                      {media[slideIndex]?.name}
                    </Text>

                    <View style={styles.row}>
                      <Pressable
                        style={styles.button}
                        onPress={() =>
                          setSlideIndex(
                            index =>
                              (index - 1 + media.length) % media.length,
                          )
                        }>
                        <Text style={styles.buttonText}>السابق</Text>
                      </Pressable>
                      <Pressable
                        style={styles.button}
                        onPress={() =>
                          setSlideIndex(index => (index + 1) % media.length)
                        }>
                        <Text style={styles.buttonText}>التالي</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </View>
            )}
          </View>

          <View style={styles.bottomTabs}>
            {(['Camera', 'Sensors', 'Gallery', 'Slideshow'] as Tab[]).map(
              tab => (
                <Pressable
                  key={tab}
                  style={[
                    styles.tabButton,
                    activeTab === tab && styles.activeTab,
                  ]}
                  onPress={() => {
                    if (isRecording && tab !== 'Camera') {
                      Alert.alert(
                        'تنبيه',
                        'أوقف تسجيل الفيديو قبل الانتقال إلى شاشة أخرى.',
                      );
                      return;
                    }

                    setActiveTab(tab);

                    if (tab === 'Gallery' || tab === 'Slideshow') {
                      loadMedia();
                    }
                  }}>
                  <Text style={styles.tabText}>
                    {tab === 'Camera'
                      ? 'الكاميرا'
                      : tab === 'Sensors'
                        ? 'الحساسات'
                        : tab === 'Gallery'
                          ? 'المعرض'
                          : 'عرض الشرائح'}
                  </Text>
                </Pressable>
              ),
            )}
          </View>
        </>
      )}
    </SafeAreaView>
  );
};

const VideoPlayerPanel = ({path}: {path: string}) => {
  const player = useVideoPlayer({uri: getUri(path)}, p => {
    p.pause();
  });

  const [playing, setPlaying] = useState(false);

  const togglePlayback = () => {
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      player.play();
      setPlaying(true);
    }
  };

  const seekBackward = () => {
    player.seekTo(Math.max(0, player.currentTime - 5));
  };

  const seekForward = () => {
    player.seekTo(player.currentTime + 5);
  };

  return (
    <View style={styles.videoPlayerContainer}>
      <VideoView
        player={player}
        style={styles.videoView}
        controls
        resizeMode="contain"
      />

      <View style={styles.row}>
        <Pressable style={styles.button} onPress={seekBackward}>
          <Text style={styles.buttonText}>-5 ثوانٍ</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={togglePlayback}>
          <Text style={styles.buttonText}>
            {playing ? 'إيقاف مؤقت' : 'تشغيل'}
          </Text>
        </Pressable>
        <Pressable style={styles.button} onPress={seekForward}>
          <Text style={styles.buttonText}>+5 ثوانٍ</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101820',
  },
  appTitle: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: 'bold',
    textAlign: 'center',
    paddingVertical: 12,
  },
  screenContent: {
    flex: 1,
  },
  contentPadding: {
    padding: 14,
    paddingBottom: 24,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 14,
  },
  cameraContainer: {
    width: '100%',
    height: 360,
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: '#000000',
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 8,
  },
  button: {
    backgroundColor: '#167DAD',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 8,
    margin: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButton: {
    backgroundColor: '#52616B',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 7,
    margin: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeButton: {
    backgroundColor: '#159957',
  },
  deleteButton: {
    backgroundColor: '#B3261E',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  captureButton: {
    backgroundColor: '#159957',
    padding: 16,
    borderRadius: 12,
    marginTop: 10,
    alignItems: 'center',
  },
  recordingButton: {
    backgroundColor: '#B3261E',
  },
  captureButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: 'bold',
  },
  recordingLabel: {
    color: '#FF6666',
    textAlign: 'center',
    marginTop: 10,
    fontWeight: 'bold',
  },
  centerBox: {
    padding: 20,
    alignItems: 'center',
  },
  infoCard: {
    backgroundColor: '#1D2B36',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  },
  infoTitle: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 17,
    marginBottom: 10,
  },
  infoText: {
    color: '#E5E7EB',
    fontSize: 15,
    marginVertical: 5,
  },
  mutedText: {
    color: '#AAB7C4',
    fontSize: 12,
    marginTop: 5,
  },
  orientationText: {
    color: '#70D6FF',
    fontSize: 22,
    fontWeight: 'bold',
    marginVertical: 8,
  },
  mediaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1D2B36',
    borderRadius: 10,
    padding: 8,
    marginVertical: 6,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: 7,
    backgroundColor: '#000000',
  },
  videoThumbnail: {
    width: 64,
    height: 64,
    borderRadius: 7,
    backgroundColor: '#263746',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoIcon: {
    color: '#70D6FF',
    fontSize: 30,
  },
  mediaDetails: {
    flex: 1,
    paddingHorizontal: 9,
  },
  mediaName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  mediaActions: {
    alignItems: 'center',
  },
  bottomTabs: {
    flexDirection: 'row',
    backgroundColor: '#17232D',
    borderTopWidth: 1,
    borderTopColor: '#344552',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 3,
    alignItems: 'center',
  },
  activeTab: {
    backgroundColor: '#167DAD',
  },
  tabText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  previewContainer: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
  },
  previewImage: {
    width: '100%',
    height: 420,
    backgroundColor: '#000000',
  },
  slideshowContainer: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideshowMedia: {
    width: '100%',
    height: 350,
    backgroundColor: '#000000',
    borderRadius: 10,
    overflow: 'hidden',
  },
  slideshowImage: {
    width: '100%',
    height: '100%',
  },
  slideshowVideo: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  viewerTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  viewerContent: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },
  viewerControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  renamePanel: {
    backgroundColor: '#1D2B36',
    borderRadius: 10,
    padding: 12,
    margin: 10,
  },
  input: {
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#52616B',
    borderRadius: 8,
    paddingHorizontal: 10,
    marginVertical: 8,
  },
  videoPlayerContainer: {
    flex: 1,
    minHeight: 260,
    backgroundColor: '#000000',
    justifyContent: 'center',
  },
  videoView: {
    width: '100%',
    height: 350,
    backgroundColor: '#000000',
  },
});

export default App;
