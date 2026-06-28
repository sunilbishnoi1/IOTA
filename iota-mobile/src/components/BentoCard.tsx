import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Easing,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { CodespaceVM } from '../types';
import { Theme } from '../styles/theme';

interface BentoCardProps {
  item: CodespaceVM;
  onPowerToggle: (name: string) => void;
  onDelete: (name: string) => void;
  onPress: (item: CodespaceVM) => void;
}

export const BentoCard: React.FC<BentoCardProps> = ({ item, onPowerToggle, onDelete, onPress }) => {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  // Pulse animation for starting state
  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (item.status === 'starting') {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.4,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
    } else {
      pulseAnim.setValue(1);
    }

    return () => {
      if (animation) {
        animation.stop();
      }
    };
  }, [item.status]);

  // Color mapping based on status
  const getStatusColor = () => {
    switch (item.status) {
      case 'active':
        return Theme.colors.secondary.default;
      case 'starting':
        return '#f59e0b'; // Amber yellow
      case 'stopping':
        return '#ef4444'; // Red
      case 'sleeping':
      default:
        return Theme.colors.text.muted;
    }
  };

  const getStatusText = () => {
    switch (item.status) {
      case 'active':
        return 'Active';
      case 'starting':
        if (item.rawState) {
          const raw = item.rawState.charAt(0).toUpperCase() + item.rawState.slice(1).toLowerCase();
          if (raw === 'Available') {
            return 'Starting Bridge...';
          }
          const normalizedRaw = item.rawState.toLowerCase();
          if (normalizedRaw === 'starting' || normalizedRaw === 'provisioning' || normalizedRaw === 'queued') {
            return `Booting (${raw})...`;
          }
        }
        return 'Booting...';
      case 'stopping':
        return 'Stopping...';
      case 'sleeping':
      default:
        return 'Sleeping';
    }
  };

  const isActive = item.status === 'active';
  const isStarting = item.status === 'starting';
  const isStopping = item.status === 'stopping';

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isActive && styles.activeCard,
      ]}
      onPress={() => isActive && onPress(item)}
      activeOpacity={isActive ? 0.7 : 0.95}
    >
      <View style={styles.cardHeader}>
        <View style={styles.statusIndicator}>
          <Animated.View
            style={[
              styles.statusDot,
              { backgroundColor: getStatusColor(), opacity: pulseAnim },
            ]}
          />
          <Text style={[styles.statusText, { color: getStatusColor() }]}>
            {getStatusText()}
          </Text>
        </View>
        
        <View style={styles.cardActions}>
          {/* Delete Button */}
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => {
              Alert.alert(
                'Delete Codespace',
                `Are you sure you want to permanently delete the codespace for "${item.repositoryName}"?\n\nThis action cannot be undone.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => onDelete(item.id),
                  },
                ]
              );
            }}
          >
            <MaterialIcons
              name="delete-outline"
              size={16}
              color={'#ef4444'}
            />
          </TouchableOpacity>

          {/* Power Toggle Button */}
          <TouchableOpacity
            style={[
              styles.powerButton,
              isActive && styles.powerButtonActive,
              isStarting && styles.powerButtonDisabled,
            ]}
            onPress={() => !isStarting && !isStopping && onPowerToggle(item.id)}
            disabled={isStarting || isStopping}
          >
            {isStarting || isStopping ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialIcons
                name={isActive ? "power-settings-new" : "play-arrow"}
                size={18}
                color={isActive ? '#fff' : Theme.colors.text.primary}
              />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.repoName} numberOfLines={1} ellipsizeMode="tail">
        {item.repositoryName.split('/')[1] || item.repositoryName}
      </Text>
      <Text style={styles.ownerName} numberOfLines={1} ellipsizeMode="tail">
        {item.repositoryName.split('/')[0] || 'github'}
      </Text>

      <View style={styles.branchContainer}>
        <MaterialIcons name="call-split" size={14} color={Theme.colors.text.muted} style={styles.branchIcon} />
        <Text style={styles.branchText} numberOfLines={1} ellipsizeMode="tail">
          {item.branchName}
        </Text>
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.computeText}>
          {item.freeHoursRemaining} / 60 hrs free
        </Text>
        {isActive && (
          <View style={styles.connectLink}>
            <Text style={styles.connectLinkText}>Enter Workspace</Text>
            <MaterialIcons name="chevron-right" size={16} color={Theme.colors.primary.glow} />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    ...Theme.glassmorphism,
    padding: 20,
    marginBottom: 16,
    minHeight: 160,
    justifyContent: 'space-between',
    position: 'relative',
    overflow: 'hidden',
  },
  activeCard: {
    borderColor: 'rgba(99, 102, 241, 0.25)',
    backgroundColor: 'rgba(99, 102, 241, 0.05)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  powerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  powerButtonActive: {
    backgroundColor: Theme.colors.accent.default,
    borderColor: Theme.colors.accent.glow,
  },
  powerButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  repoName: {
    fontSize: 20,
    fontWeight: '700',
    color: Theme.colors.text.primary,
    marginBottom: 2,
  },
  ownerName: {
    fontSize: 12,
    color: Theme.colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  branchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  branchIcon: {
    marginRight: 4,
    transform: [{ rotate: '90deg' }],
  },
  branchText: {
    fontSize: 13,
    color: Theme.colors.text.secondary,
    fontWeight: '500',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
    paddingTop: 12,
  },
  computeText: {
    fontSize: 12,
    color: Theme.colors.text.muted,
    fontWeight: '500',
  },
  connectLink: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectLinkText: {
    fontSize: 12,
    color: Theme.colors.primary.glow,
    fontWeight: '600',
    marginRight: 2,
  },
});
