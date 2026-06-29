import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Linking, Modal, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Theme } from '../../styles/theme';

interface PreviewExpoGoProps {
  url: string; // exps://...
  port: number;
}

export const PreviewExpoGo: React.FC<PreviewExpoGoProps> = ({ url, port }) => {
  const [showDownloadModal, setShowDownloadModal] = useState(false);

  const openExpoGo = async () => {
    try {
      // Bypass canOpenURL check as it returns false on iOS when scheme is not in LSApplicationQueriesSchemes
      await Linking.openURL(url);
    } catch (error) {
      console.error('Failed to open Expo Go URL directly:', error);
      setShowDownloadModal(true);
    }
  };

  const openStore = (store: 'ios' | 'android') => {
    const storeUrl = store === 'ios'
      ? 'https://apps.apple.com/app/expo-go/id984021028'
      : 'https://play.google.com/store/apps/details?id=host.exp.exponent';
    Linking.openURL(storeUrl);
  };

  // Generate QR code URL using qrserver API
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&color=ffffff&bgcolor=0c0a1c&data=${encodeURIComponent(url)}`;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.headline}>Expo Go Preview</Text>
        <Text style={styles.subheadline}>Scan QR code or click the button below to preview in Expo Go</Text>

        <View style={styles.qrContainer}>
          <Image
            source={{ uri: qrCodeUrl }}
            style={styles.qrImage}
            resizeMode="contain"
          />
        </View>

        <TouchableOpacity onPress={openExpoGo} style={styles.button}>
          <MaterialIcons name="launch" size={18} color="#fff" />
          <Text style={styles.buttonText}>Open in Expo Go</Text>
        </TouchableOpacity>

        <Text style={styles.urlText}>{url}</Text>
      </View>

      {/* Download Modal */}
      <Modal
        visible={showDownloadModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowDownloadModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <MaterialIcons name="error-outline" size={24} color={Theme.colors.accent.default} />
              <Text style={styles.modalTitle}>Expo Go Required</Text>
            </View>

            <Text style={styles.modalDescription}>
              Could not open the preview link. Please make sure the Expo Go app is installed on your device.
            </Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => openStore('ios')}
                style={[styles.modalButton, styles.iosButton]}
              >
                <MaterialIcons name="apple" size={18} color="#fff" />
                <Text style={styles.modalButtonText}>App Store</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => openStore('android')}
                style={[styles.modalButton, styles.androidButton]}
              >
                <MaterialIcons name="android" size={18} color="#fff" />
                <Text style={styles.modalButtonText}>Google Play</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => setShowDownloadModal(false)}
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    ...Theme.glassmorphism,
    width: '100%',
    maxWidth: 340,
    backgroundColor: 'rgba(12, 10, 28, 0.4)',
    padding: 20,
    alignItems: 'center',
  },
  headline: {
    color: Theme.colors.text.primary,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subheadline: {
    color: Theme.colors.text.secondary,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
  },
  qrContainer: {
    backgroundColor: '#0c0a1c',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrImage: {
    width: 180,
    height: 180,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.colors.primary.default,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: '100%',
    marginBottom: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  urlText: {
    color: Theme.colors.text.muted,
    fontSize: 10,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#16142c',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    padding: 24,
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    color: Theme.colors.text.primary,
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  modalDescription: {
    color: Theme.colors.text.secondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 16,
  },
  modalButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  iosButton: {
    backgroundColor: '#333',
  },
  androidButton: {
    backgroundColor: '#00c497',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    color: Theme.colors.text.muted,
    fontSize: 13,
  },
});
