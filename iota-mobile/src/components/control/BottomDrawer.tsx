import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Theme } from '../../styles/theme';

const SCREEN_HEIGHT = Dimensions.get('window').height;

interface BottomDrawerProps {
  visible: boolean;
  title: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  onClose?: () => void;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  maxHeight?: number;
}

export const BottomDrawer: React.FC<BottomDrawerProps> = ({
  visible,
  title,
  icon,
  onClose,
  headerRight,
  children,
  maxHeight = SCREEN_HEIGHT * 0.35,
}) => {
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 1 : 0,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [visible]);

  const animatedMaxHeight = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, maxHeight],
  });

  const animatedOpacity = slideAnim.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 0, 1],
  });

  return (
    <Animated.View
      style={[
        styles.container,
        {
          maxHeight: animatedMaxHeight,
          opacity: slideAnim,
        },
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {icon && (
            <MaterialIcons name={icon} size={18} color={Theme.colors.primary.glow} />
          )}
          <Text style={styles.headerTitle}>{title}</Text>
        </View>
        <View style={styles.headerRight}>
          {headerRight}
          {onClose && (
            <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.7}>
              <MaterialIcons name="close" size={18} color={Theme.colors.text.secondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: animatedOpacity }}>
          {children}
        </Animated.View>
      </ScrollView>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(10, 8, 30, 0.96)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(231, 231, 231, 0.5)',
    overflow: 'hidden',
    shadowColor: Theme.colors.primary.default,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Theme.colors.text.primary,
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flexGrow: 0,
  },
  contentInner: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
});
