import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { BottomDrawer } from './BottomDrawer';
import { ModelInfo, ModelVariant } from '../../types/opencode';
import { Theme } from '../../styles/theme';

interface ModelPickerProps {
  visible: boolean;
  models: ModelInfo[];
  activeModel?: string;
  activeVariant?: string;
  loading?: boolean;
  onSelectModel: (modelID: string, variant?: string) => void;
  onClose: () => void;
}

const ModelRow = React.memo<{
  model: ModelInfo;
  isActive: boolean;
  activeVariant?: string;
  hasVariants: boolean;
  onPress: () => void;
}>(({ model, isActive, activeVariant, hasVariants, onPress }) => (
  <TouchableOpacity
    style={[styles.modelRow, isActive && styles.modelRowActive]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <View style={styles.modelInfo}>
      <Text style={[styles.modelName, isActive && styles.modelNameActive]}>
        {model.name}
      </Text>
      <Text style={styles.modelID}>{model.modelID}</Text>
      {isActive && activeVariant && (
        <Text style={styles.variantLabel}>Variant: {activeVariant}</Text>
      )}
    </View>
    {isActive && (
      <MaterialIcons name="check-circle" size={18} color={Theme.colors.primary.glow} />
    )}
    {hasVariants && (
      <MaterialIcons name="chevron-right" size={18} color={Theme.colors.text.secondary} />
    )}
  </TouchableOpacity>
));

const VariantRow = React.memo<{
  variant: ModelVariant;
  isActive: boolean;
  onSelect: () => void;
}>(({ variant, isActive, onSelect }) => (
  <TouchableOpacity
    style={[styles.variantRow, isActive && styles.variantRowActive]}
    onPress={onSelect}
    activeOpacity={0.7}
  >
    <View style={styles.variantInfo}>
      <Text style={[styles.variantName, isActive && styles.variantNameActive]}>
        {variant.id}
      </Text>
      <Text style={styles.variantDesc}>{variant.description}</Text>
    </View>
    {isActive && (
      <MaterialIcons name="check-circle" size={18} color={Theme.colors.primary.glow} />
    )}
  </TouchableOpacity>
));

export const ModelPicker: React.FC<ModelPickerProps> = ({
  visible,
  models,
  activeModel,
  activeVariant,
  loading,
  onSelectModel,
  onClose,
}) => {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (visible) {
      setSelectedProvider(null);
      setSelectedModelId(null);
      setSearchQuery('');
    }
  }, [visible]);

  const sortedAndFilteredModels = useMemo(() => {
    const filtered = searchQuery
      ? models.filter(m =>
          m.providerID.toLowerCase().includes(searchQuery) ||
          m.modelID.toLowerCase().includes(searchQuery) ||
          m.name.toLowerCase().includes(searchQuery)
        )
      : models;
    const sorted = [...filtered].sort((a, b) => {
      const aFull = `${a.providerID}/${a.modelID}`;
      const bFull = `${b.providerID}/${b.modelID}`;
      const aActive = aFull === activeModel || a.modelID === activeModel;
      const bActive = bFull === activeModel || b.modelID === activeModel;
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      const aIsOpencode = a.providerID.toLowerCase().includes('opencode');
      const bIsOpencode = b.providerID.toLowerCase().includes('opencode');
      if (aIsOpencode && !bIsOpencode) return -1;
      if (!aIsOpencode && bIsOpencode) return 1;
      return 0;
    });
    return sorted;
  }, [models, searchQuery, activeModel]);

  const providerGroups = useMemo(() => {
    const groups = new Map<string, ModelInfo[]>();
    for (const m of sortedAndFilteredModels) {
      const existing = groups.get(m.providerID) || [];
      existing.push(m);
      groups.set(m.providerID, existing);
    }
    return groups;
  }, [sortedAndFilteredModels]);

  const isActive = useCallback((model: ModelInfo) => {
    const fullID = `${model.providerID}/${model.modelID}`;
    return fullID === activeModel || model.modelID === activeModel;
  }, [activeModel]);

  const handleSelectModel = useCallback((model: ModelInfo) => {
    if (model.variants.length > 0 && !selectedModelId) {
      setSelectedProvider(model.providerID);
      setSelectedModelId(model.modelID);
      return;
    }
    onSelectModel(`${model.providerID}/${model.modelID}`, undefined);
    onClose();
  }, [onSelectModel, onClose, selectedModelId]);

  const handleSelectVariant = useCallback((variant: ModelVariant) => {
    if (!selectedModelId) return;
    for (const models of providerGroups.values()) {
      for (const m of models) {
        if (m.modelID === selectedModelId) {
          onSelectModel(`${m.providerID}/${m.modelID}`, variant.id);
          onClose();
          return;
        }
      }
    }
  }, [selectedModelId, providerGroups, onSelectModel, onClose]);

  const selectedModels = selectedProvider ? providerGroups.get(selectedProvider) || [] : [];
  const variantList = selectedModelId
    ? selectedModels.find(m => m.modelID === selectedModelId)?.variants || []
    : [];

  const handleSelectDefaultVariant = useCallback(() => {
    if (!selectedModelId) return;
    for (const m of selectedModels) {
      if (m.modelID === selectedModelId) {
        onSelectModel(`${m.providerID}/${m.modelID}`, undefined);
        onClose();
        return;
      }
    }
  }, [selectedModelId, selectedModels, onSelectModel, onClose]);

  const handleBackToModels = useCallback(() => {
    setSelectedProvider(null);
    setSelectedModelId(null);
  }, []);

  const renderProviderGroups = useCallback(() => (
    <>
      {Array.from(providerGroups.entries()).map(([providerID, providerModels]) => (
        <View key={providerID} style={styles.providerSection}>
          <Text style={styles.providerLabel}>{providerID}</Text>
          {providerModels.map((model) => (
            <ModelRow
              key={model.modelID}
              model={model}
              isActive={isActive(model)}
              activeVariant={activeVariant}
              hasVariants={model.variants.length > 0}
              onPress={() => handleSelectModel(model)}
            />
          ))}
        </View>
      ))}
    </>
  ), [providerGroups, isActive, activeVariant, handleSelectModel]);

  const renderVariants = useCallback(() => {
    const modelName = selectedModels.find(m => m.modelID === selectedModelId)?.name || selectedModelId;
    return (
      <>
        <TouchableOpacity style={styles.backRow} onPress={handleBackToModels} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={18} color={Theme.colors.primary.glow} />
          <Text style={styles.backText}>Back to models</Text>
        </TouchableOpacity>
        <Text style={styles.variantTitle}>{modelName}</Text>
        {variantList.length === 0 && (
          <TouchableOpacity
            style={styles.variantRow}
            onPress={handleSelectDefaultVariant}
            activeOpacity={0.7}
          >
            <Text style={styles.variantName}>Default</Text>
            <Text style={styles.variantDesc}>No variant (default behavior)</Text>
          </TouchableOpacity>
        )}
        {variantList.map((v) => (
          <VariantRow
            key={v.id}
            variant={v}
            isActive={activeVariant === v.id}
            onSelect={() => handleSelectVariant(v)}
          />
        ))}
      </>
    );
  }, [selectedModels, selectedModelId, variantList, activeVariant, handleBackToModels, handleSelectVariant, handleSelectDefaultVariant]);

  return (
    <BottomDrawer
      visible={visible}
      title={selectedModelId ? 'Select Variant' : 'Select Model'}
      icon="smartphone"
      onClose={onClose}
      maxHeight={Dimensions.get('window').height * 0.6}
    >
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={Theme.colors.primary.glow} />
          <Text style={styles.loadingText}>Loading models...</Text>
        </View>
      ) : (
        <View style={styles.listContainer}>
          {!selectedModelId && (
            <View style={styles.searchContainer}>
              <MaterialIcons name="search" size={16} color={Theme.colors.text.muted} />
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search providers or models"
                placeholderTextColor={Theme.colors.text.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.7}>
                  <MaterialIcons name="close" size={16} color={Theme.colors.text.muted} />
                </TouchableOpacity>
              )}
            </View>
          )}
          {selectedModelId ? renderVariants() : renderProviderGroups()}
        </View>
      )}
    </BottomDrawer>
  );
};

const styles = StyleSheet.create({
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: Theme.colors.text.primary,
    paddingVertical: 0,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    color: Theme.colors.text.secondary,
  },
  listContainer: {
    flex: 1,
  },
  providerSection: {
    marginBottom: 12,
  },
  providerLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 2,
  },
  modelRowActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
  },
  modelInfo: {
    flex: 1,
    marginRight: 8,
  },
  modelName: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.colors.text.primary,
  },
  modelNameActive: {
    color: Theme.colors.primary.glow,
  },
  modelID: {
    fontSize: 11,
    color: Theme.colors.text.muted,
    marginTop: 1,
  },
  variantLabel: {
    fontSize: 11,
    color: Theme.colors.primary.glow,
    marginTop: 2,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    marginBottom: 8,
  },
  backText: {
    fontSize: 13,
    fontWeight: '600',
    color: Theme.colors.primary.glow,
  },
  variantTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Theme.colors.text.primary,
    marginBottom: 12,
  },
  variantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 4,
  },
  variantRowActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
  },
  variantInfo: {
    flex: 1,
    marginRight: 8,
  },
  variantName: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.colors.text.primary,
  },
  variantNameActive: {
    color: Theme.colors.primary.glow,
  },
  variantDesc: {
    fontSize: 11,
    color: Theme.colors.text.muted,
    marginTop: 1,
  },
});