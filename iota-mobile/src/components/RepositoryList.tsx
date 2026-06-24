import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { GitHubRepository } from '../types';
import { Theme } from '../styles/theme';

interface RepositoryListProps {
  repositories: GitHubRepository[];
  loading: boolean;
  onSelectRepository: (repo: GitHubRepository) => void;
  onClose: () => void;
}

export const RepositoryList: React.FC<RepositoryListProps> = ({
  repositories,
  loading,
  onSelectRepository,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRepositories = repositories.filter((repo) =>
    repo.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (repo.description && repo.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const renderItem = ({ item }: { item: GitHubRepository }) => (
    <TouchableOpacity
      style={styles.repoItem}
      onPress={() => onSelectRepository(item)}
      activeOpacity={0.7}
    >
      <View style={styles.repoIconContainer}>
        <MaterialIcons name="folder" size={20} color={Theme.colors.primary.glow} />
      </View>
      <View style={styles.repoDetails}>
        <Text style={styles.repoName} numberOfLines={1} ellipsizeMode="tail">
          {item.name}
        </Text>
        <Text style={styles.repoFullName} numberOfLines={1} ellipsizeMode="tail">
          {item.fullName}
        </Text>
        {item.description ? (
          <Text style={styles.repoDesc} numberOfLines={1} ellipsizeMode="tail">
            {item.description}
          </Text>
        ) : null}
        <View style={styles.badgeRow}>
          <View style={styles.branchBadge}>
            <MaterialIcons name="call-split" size={10} color={Theme.colors.text.secondary} style={styles.badgeIcon} />
            <Text style={styles.branchBadgeText}>{item.defaultBranch}</Text>
          </View>
        </View>
      </View>
      <MaterialIcons name="chevron-right" size={24} color={Theme.colors.text.muted} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Select Repository</Text>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <MaterialIcons name="close" size={20} color={Theme.colors.text.secondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchBarContainer}>
        <MaterialIcons name="search" size={20} color={Theme.colors.text.muted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search repositories..."
          placeholderTextColor={Theme.colors.text.muted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <MaterialIcons name="cancel" size={16} color={Theme.colors.text.muted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Theme.colors.primary.default} />
          <Text style={styles.loadingText}>Fetching GitHub repositories...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredRepositories}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialIcons name="search-off" size={40} color={Theme.colors.text.muted} />
              <Text style={styles.emptyText}>No repositories found</Text>
              <Text style={styles.emptySubText}>Try another search query or check your connection</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.text.primary,
  },
  closeButton: {
    padding: 4,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: Theme.colors.border,
    borderWidth: 1,
    borderRadius: 10,
    marginHorizontal: 20,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 16,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: Theme.colors.text.primary,
    fontSize: 14,
    height: '100%',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 12,
    color: Theme.colors.text.secondary,
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  repoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    ...Theme.glassmorphism,
    padding: 16,
    marginBottom: 12,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  repoIconContainer: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  repoDetails: {
    flex: 1,
    marginRight: 8,
  },
  repoName: {
    fontSize: 16,
    fontWeight: '600',
    color: Theme.colors.text.primary,
    marginBottom: 2,
  },
  repoFullName: {
    fontSize: 11,
    color: Theme.colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  repoDesc: {
    fontSize: 12,
    color: Theme.colors.text.secondary,
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: 'row',
  },
  branchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  badgeIcon: {
    marginRight: 4,
    transform: [{ rotate: '90deg' }],
  },
  branchBadgeText: {
    fontSize: 10,
    fontWeight: '500',
    color: Theme.colors.text.secondary,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: Theme.colors.text.secondary,
    marginTop: 12,
    marginBottom: 4,
  },
  emptySubText: {
    fontSize: 13,
    color: Theme.colors.text.muted,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});
