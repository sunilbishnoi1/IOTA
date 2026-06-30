import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  SectionList,
  Alert,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Theme } from '../../styles/theme';
import { OpenCodeConversation } from '../../types/opencode';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(300, SCREEN_WIDTH * 0.8);

interface HistoryDrawerProps {
  visible: boolean;
  conversations: OpenCodeConversation[];
  activeConversationId?: string;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onClose: () => void;
  onNewChat: () => void;
}

function getRelativeTime(dateString?: string): string {
  if (!dateString) return 'Just now';
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function groupConversations(items: OpenCodeConversation[]) {
  const today: OpenCodeConversation[] = [];
  const yesterday: OpenCodeConversation[] = [];
  const older: OpenCodeConversation[] = [];
  
  const now = new Date();
  const todayStr = now.toDateString();
  
  const yesterdayDate = new Date();
  yesterdayDate.setDate(now.getDate() - 1);
  const yesterdayStr = yesterdayDate.toDateString();

  for (const item of items) {
    if (!item.updatedAt) continue;
    const itemDate = new Date(item.updatedAt);
    const itemDateStr = itemDate.toDateString();
    
    if (itemDateStr === todayStr) {
      today.push(item);
    } else if (itemDateStr === yesterdayStr) {
      yesterday.push(item);
    } else {
      older.push(item);
    }
  }

  return [
    { title: 'Today', data: today },
    { title: 'Yesterday', data: yesterday },
    { title: 'Older', data: older },
  ].filter((g) => g.data.length > 0);
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  visible,
  conversations,
  activeConversationId,
  onSelectConversation,
  onDeleteConversation,
  onClose,
  onNewChat,
}) => {
  const slideAnim = useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: DRAWER_WIDTH,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  const grouped = groupConversations(conversations);

  const handleDeletePress = (id: string, title?: string) => {
    Alert.alert(
      'Delete Conversation',
      `Are you sure you want to delete "${title || 'Untitled'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDeleteConversation(id),
        },
      ]
    );
  };

  return (
    <View style={StyleSheet.absoluteFillObject}>
      {/* Backdrop */}
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]} />
      </TouchableWithoutFeedback>

      {/* Drawer */}
      <Animated.View
        style={[
          styles.drawer,
          {
            transform: [{ translateX: slideAnim }],
          },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>History</Text>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <MaterialIcons name="chevron-right" size={24} color={Theme.colors.primary.glow} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.newChatButton}
          onPress={() => {
            onNewChat();
            onClose();
          }}
          activeOpacity={0.7}
        >
          <MaterialIcons name="add" size={20} color="#ffffff" />
          <Text style={styles.newChatButtonText}>New Chat</Text>
        </TouchableOpacity>

        <SectionList
          sections={grouped}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const isActive = item.id === activeConversationId;
            const messageCount = item.messages ? item.messages.length : 0;
            return (
              <TouchableOpacity
                style={[
                  styles.item,
                  isActive && styles.activeItem,
                ]}
                activeOpacity={0.7}
                onPress={() => {
                  onSelectConversation(item.id);
                  onClose();
                }}
                onLongPress={() => handleDeletePress(item.id, item.title)}
              >
                <View style={styles.itemLeft}>
                  <MaterialIcons
                    name="chat"
                    size={18}
                    color={isActive ? Theme.colors.primary.glow : Theme.colors.text.muted}
                    style={styles.chatIcon}
                  />
                  <View style={styles.itemMeta}>
                    <Text
                      style={[
                        styles.itemTitle,
                        isActive && styles.activeItemTitle,
                      ]}
                      numberOfLines={1}
                    >
                      {item.title || 'Untitled Session'}
                    </Text>
                    <Text style={styles.itemSubtitle}>
                      {messageCount} message{messageCount !== 1 ? 's' : ''} • {getRelativeTime(item.updatedAt)}
                    </Text>
                  </View>
                </View>
                
                {item.status === 'running' && (
                  <View style={styles.statusPulse} />
                )}

                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDeletePress(item.id, item.title)}
                >
                  <MaterialIcons name="delete-outline" size={18} color={Theme.colors.accent.default} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialIcons name="history-toggle-off" size={48} color={Theme.colors.text.muted} />
              <Text style={styles.emptyText}>No saved chats found</Text>
            </View>
          }
        />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  drawer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: '#070519',
    borderLeftWidth: 1,
    borderLeftColor: Theme.colors.border,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    zIndex: 9999,
  },
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    height: 40,
    borderRadius: 8,
    backgroundColor: Theme.colors.primary.default,
  },
  newChatButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.text.primary,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  listContent: {
    paddingVertical: 12,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.colors.text.muted,
    letterSpacing: 1.5,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 8,
    borderRadius: 10,
    marginBottom: 4,
  },
  activeItem: {
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.25)',
  },
  itemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chatIcon: {
    marginRight: 12,
  },
  itemMeta: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 14,
    color: Theme.colors.text.secondary,
    fontWeight: '500',
    marginBottom: 2,
  },
  activeItemTitle: {
    color: Theme.colors.text.primary,
    fontWeight: '600',
  },
  itemSubtitle: {
    fontSize: 11,
    color: Theme.colors.text.muted,
  },
  statusPulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Theme.colors.secondary.default,
    marginRight: 8,
  },
  deleteButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(244, 63, 94, 0.03)',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: Theme.colors.text.muted,
  },
});
