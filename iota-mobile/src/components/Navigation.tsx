import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Theme } from '../styles/theme';

export type TabType = 'dashboard' | 'terminal' | 'ship';

interface NavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  hasActiveCodespace: boolean;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onTabChange,
  hasActiveCodespace,
}) => {
  const tabs = [
    {
      id: 'dashboard' as TabType,
      label: 'Matrix',
      icon: 'grid-view',
      requiresActive: false,
    },
    {
      id: 'terminal' as TabType,
      label: 'Control',
      icon: 'chat',
      requiresActive: true,
    },
    {
      id: 'ship' as TabType,
      label: 'Ship',
      icon: 'unarchive',
      requiresActive: true,
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.navBar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const isLocked = tab.requiresActive && !hasActiveCodespace;

          return (
            <TouchableOpacity
              key={tab.id}
              style={[
                styles.navItem,
                isActive && styles.activeNavItem,
              ]}
              onPress={() => {
                if (!isLocked) {
                  onTabChange(tab.id);
                }
              }}
              activeOpacity={isLocked ? 1 : 0.7}
            >
              <View style={styles.iconWrapper}>
                <MaterialIcons
                  name={tab.icon as any}
                  size={20}
                  color={
                    isActive
                      ? Theme.colors.primary.glow
                      : isLocked
                      ? 'rgba(255, 255, 255, 0.15)'
                      : Theme.colors.text.secondary
                  }
                />
                {isLocked && (
                  <View style={styles.lockBadge}>
                    <MaterialIcons name="lock" size={8} color="#fff" />
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.navLabel,
                  isActive && styles.activeNavLabel,
                  isLocked && styles.lockedNavLabel,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 34 : 20,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(15, 12, 30, 0.75)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderRadius: 30,
    width: width - 48,
    maxWidth: 360,
    paddingVertical: 8,
    paddingHorizontal: 16,
    // Glassmorphic shadow/glow
    shadowColor: Theme.colors.primary.default,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  activeNavItem: {
    // Optional active state styling
  },
  iconWrapper: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  lockBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: Theme.colors.accent.default,
    width: 12,
    height: 12,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Theme.colors.background,
  },
  navLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: Theme.colors.text.secondary,
    letterSpacing: 0.2,
  },
  activeNavLabel: {
    color: Theme.colors.primary.glow,
    fontWeight: '700',
  },
  lockedNavLabel: {
    color: 'rgba(255, 255, 255, 0.15)',
  },
});
