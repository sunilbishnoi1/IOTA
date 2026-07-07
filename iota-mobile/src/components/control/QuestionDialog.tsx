import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Socket } from 'socket.io-client';
import { OpenCodeQuestionRequest } from '../../types/opencode';
import { emitOpenCodeQuestionReply, emitOpenCodeQuestionReject } from '../../services/opencodeSocket';
import { Theme } from '../../styles/theme';

interface QuestionDialogProps {
  question: OpenCodeQuestionRequest | null;
  conversationId: string | undefined;
  socket: Socket | null;
  onDismiss: () => void;
  onCollapse?: () => void;
  visible?: boolean;
}

export const QuestionDialog: React.FC<QuestionDialogProps> = ({
  question,
  conversationId,
  socket,
  onDismiss,
  onCollapse,
  visible,
}) => {
  const [answers, setAnswers] = useState<string[][]>([]);
  const [customTexts, setCustomTexts] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<number>(0);

  const reset = useCallback(() => {
    setAnswers([]);
    setCustomTexts([]);
    setActiveTab(0);
  }, []);

  useEffect(() => {
    if (question?.id) {
      setActiveTab(0);
      setAnswers([]);
      setCustomTexts([]);
    }
  }, [question?.id]);

  const questionItems = question?.questions ?? [];

  const initializedAnswers = useMemo(() => {
    if (answers.length === questionItems.length) return answers;
    return questionItems.map(() => []);
  }, [questionItems.length, answers]);

  const initializedCustomTexts = useMemo(() => {
    if (customTexts.length === questionItems.length) return customTexts;
    return questionItems.map(() => '');
  }, [questionItems.length, customTexts]);

  const toggleOption = useCallback((questionIdx: number, label: string, isMultiple: boolean) => {
    setAnswers((prev) => {
      const current = [...(prev.length > questionIdx ? prev : questionItems.map(() => []))];
      const selected = [...(current[questionIdx] || [])];

      if (isMultiple) {
        const idx = selected.indexOf(label);
        if (idx >= 0) {
          selected.splice(idx, 1);
        } else {
          selected.push(label);
        }
      } else {
        if (selected[0] === label) {
          current[questionIdx] = [];
          return current;
        }
        current[questionIdx] = [label];
        return current;
      }

      current[questionIdx] = selected;
      return current;
    });
  }, [questionItems.length]);

  const updateCustomText = useCallback((questionIdx: number, text: string) => {
    setCustomTexts((prev) => {
      const current = [...(prev.length > questionIdx ? prev : questionItems.map(() => ''))];
      current[questionIdx] = text;
      return current;
    });
  }, [questionItems.length]);

  const isValid = useMemo(() => {
    return questionItems.every((item, idx) => {
      const selected = initializedAnswers[idx] || [];
      const custom = initializedCustomTexts[idx] || '';
      return selected.length > 0 || (item.custom && custom.trim().length > 0);
    });
  }, [questionItems, initializedAnswers, initializedCustomTexts]);

  const isCurrentQuestionValid = useMemo(() => {
    if (activeTab >= questionItems.length) return true;
    const item = questionItems[activeTab];
    if (!item) return false;
    const selected = initializedAnswers[activeTab] || [];
    const custom = initializedCustomTexts[activeTab] || '';
    return selected.length > 0 || (item.custom && custom.trim().length > 0);
  }, [questionItems, activeTab, initializedAnswers, initializedCustomTexts]);

  const renderReviewStep = () => {
    return (
      <View style={styles.reviewContainer}>
        <Text style={styles.reviewTitle}>Review Answers</Text>
        <Text style={styles.reviewSubtitle}>Please verify your answers before submitting.</Text>
        {questionItems.map((item, idx) => {
          const selected = initializedAnswers[idx] || [];
          const custom = initializedCustomTexts[idx] || '';
          return (
            <View key={idx} style={styles.reviewItem}>
              <View style={styles.reviewItemHeaderRow}>
                <Text style={styles.reviewItemQuestionHeader}>
                  {item.header || `QUESTION ${idx + 1}`}
                </Text>
                <TouchableOpacity
                  onPress={() => setActiveTab(idx)}
                  style={styles.reviewEditButton}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="edit" size={14} color={Theme.colors.primary.glow} />
                  <Text style={styles.reviewEditText}>Edit</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.reviewItemQuestionText}>{item.question}</Text>
              
              <View style={styles.reviewAnswersList}>
                {selected.map((ans, aIdx) => (
                  <View key={aIdx} style={styles.reviewAnswerBadge}>
                    <Text style={styles.reviewAnswerText}>{ans}</Text>
                  </View>
                ))}
                {item.custom && custom.trim().length > 0 && (
                  <View style={styles.reviewAnswerBadgeCustom}>
                    <Text style={styles.reviewAnswerTextCustom}>{custom.trim()}</Text>
                  </View>
                )}
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const handleSubmit = useCallback(() => {
    if (!question || !conversationId) return;

    const finalAnswers = questionItems.map((item, idx) => {
      const selected = [...(initializedAnswers[idx] || [])];
      const custom = initializedCustomTexts[idx]?.trim();
      if (item.custom && custom) {
        selected.push(custom);
      }
      return selected;
    });

    emitOpenCodeQuestionReply(socket, {
      conversationId,
      requestId: question.id,
      answers: finalAnswers,
    });
    reset();
    onDismiss();
  }, [question, conversationId, questionItems, initializedAnswers, initializedCustomTexts, socket, reset, onDismiss]);

  const handleSkip = useCallback(() => {
    if (!question || !conversationId) return;
    emitOpenCodeQuestionReject(socket, {
      conversationId,
      requestId: question.id,
    });
    reset();
    onDismiss();
  }, [question, conversationId, socket, reset, onDismiss]);

  if (!question) return null;

  return (
    <Modal
      visible={visible ?? !!question}
      animationType="slide"
      transparent
      onRequestClose={handleSkip}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <MaterialIcons name="help-outline" size={20} color={Theme.colors.primary.glow} />
              <Text style={styles.headerTitle}>Question from Agent</Text>
            </View>
            <View style={styles.headerRight}>
              {question.tool && (
                <View style={styles.toolBadge}>
                  <Text style={styles.toolBadgeText}>{question.tool}</Text>
                </View>
              )}
              {onCollapse && (
                <TouchableOpacity
                  onPress={onCollapse}
                  style={styles.collapseButton}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="keyboard-arrow-down" size={24} color={Theme.colors.primary.glow} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {questionItems.length > 1 && (
            <View style={styles.tabBarContainer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabBar}
              >
                {questionItems.map((item, idx) => {
                  const isActive = activeTab === idx;
                  const isAnswered = (initializedAnswers[idx] || []).length > 0 || (item.custom && (initializedCustomTexts[idx] || '').trim().length > 0);
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[
                        styles.tabButton,
                        isActive && styles.tabButtonActive,
                      ]}
                      onPress={() => setActiveTab(idx)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.tabContent}>
                        {isAnswered && (
                          <MaterialIcons
                            name="check-circle"
                            size={14}
                            color={isActive ? Theme.colors.primary.glow : Theme.colors.secondary.default}
                            style={{ marginRight: 4 }}
                          />
                        )}
                        <Text style={[
                          styles.tabText,
                          isActive && styles.tabTextActive,
                        ]}>
                          {item.header || `Q${idx + 1}`}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={[
                    styles.tabButton,
                    activeTab === questionItems.length && styles.tabButtonActive,
                    !isValid && styles.tabButtonDisabled,
                  ]}
                  onPress={() => isValid && setActiveTab(questionItems.length)}
                  disabled={!isValid}
                  activeOpacity={0.7}
                >
                  <View style={styles.tabContent}>
                    <MaterialIcons
                      name="rate-review"
                      size={14}
                      color={activeTab === questionItems.length ? Theme.colors.primary.glow : isValid ? Theme.colors.text.secondary : 'rgba(255, 255, 255, 0.2)'}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={[
                      styles.tabText,
                      activeTab === questionItems.length && styles.tabTextActive,
                      !isValid && styles.tabTextDisabled,
                    ]}>
                      Review
                    </Text>
                  </View>
                </TouchableOpacity>
              </ScrollView>
            </View>
          )}

          <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
            {questionItems.length > 1 ? (
              activeTab === questionItems.length ? (
                renderReviewStep()
              ) : (
                <View style={styles.questionSection}>
                  {questionItems[activeTab].header && (
                    <Text style={styles.questionHeader}>{questionItems[activeTab].header}</Text>
                  )}
                  <Text style={styles.questionText}>{questionItems[activeTab].question}</Text>

                  {questionItems[activeTab].options && questionItems[activeTab].options!.length > 0 && (
                    <View style={styles.optionsContainer}>
                      {questionItems[activeTab].options!.map((option, oIdx) => {
                        const isSelected = (initializedAnswers[activeTab] || []).includes(option.label);
                        const iconName = questionItems[activeTab].multiple
                          ? (isSelected ? 'check-box' : 'check-box-outline-blank')
                          : (isSelected ? 'radio-button-checked' : 'radio-button-unchecked');

                        return (
                          <TouchableOpacity
                            key={oIdx}
                            style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                            onPress={() => toggleOption(activeTab, option.label, !!questionItems[activeTab].multiple)}
                            activeOpacity={0.7}
                          >
                            <MaterialIcons
                              name={iconName}
                              size={20}
                              color={isSelected ? Theme.colors.primary.glow : Theme.colors.text.muted}
                            />
                            <View style={styles.optionTextContainer}>
                              <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                                {option.label}
                              </Text>
                              {option.description && (
                                <Text style={styles.optionDescription}>{option.description}</Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  {questionItems[activeTab].custom && (
                    <View style={styles.customInputContainer}>
                      <TextInput
                        style={styles.customInput}
                        placeholder="Type your answer..."
                        placeholderTextColor={Theme.colors.text.muted}
                        value={initializedCustomTexts[activeTab] || ''}
                        onChangeText={(text) => updateCustomText(activeTab, text)}
                        multiline
                      />
                    </View>
                  )}
                </View>
              )
            ) : (
              questionItems.map((item, qIdx) => (
                <View key={qIdx} style={styles.questionSection}>
                  {item.header && (
                    <Text style={styles.questionHeader}>{item.header}</Text>
                  )}
                  <Text style={styles.questionText}>{item.question}</Text>

                  {item.options && item.options.length > 0 && (
                    <View style={styles.optionsContainer}>
                      {item.options.map((option, oIdx) => {
                        const isSelected = (initializedAnswers[qIdx] || []).includes(option.label);
                        const iconName = item.multiple
                          ? (isSelected ? 'check-box' : 'check-box-outline-blank')
                          : (isSelected ? 'radio-button-checked' : 'radio-button-unchecked');

                        return (
                          <TouchableOpacity
                            key={oIdx}
                            style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                            onPress={() => toggleOption(qIdx, option.label, !!item.multiple)}
                            activeOpacity={0.7}
                          >
                            <MaterialIcons
                              name={iconName}
                              size={20}
                              color={isSelected ? Theme.colors.primary.glow : Theme.colors.text.muted}
                            />
                            <View style={styles.optionTextContainer}>
                              <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                                {option.label}
                              </Text>
                              {option.description && (
                                <Text style={styles.optionDescription}>{option.description}</Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  {item.custom && (
                    <View style={styles.customInputContainer}>
                      <TextInput
                        style={styles.customInput}
                        placeholder="Type your answer..."
                        placeholderTextColor={Theme.colors.text.muted}
                        value={initializedCustomTexts[qIdx] || ''}
                        onChangeText={(text) => updateCustomText(qIdx, text)}
                        multiline
                      />
                    </View>
                  )}
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={[styles.skipButton, questionItems.length > 1 && activeTab > 0 ? { flex: 0.3 } : { flex: 0.4 }]} onPress={handleSkip} activeOpacity={0.7}>
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>

            {questionItems.length > 1 && activeTab > 0 && (
              <TouchableOpacity style={[styles.backButton, { flex: 0.3 }]} onPress={() => setActiveTab((prev) => prev - 1)} activeOpacity={0.7}>
                <Text style={styles.backText}>Back</Text>
              </TouchableOpacity>
            )}

            {questionItems.length > 1 ? (
              activeTab === questionItems.length ? (
                <TouchableOpacity
                  style={[styles.submitButton, !isValid && styles.submitButtonDisabled, questionItems.length > 1 && activeTab > 0 ? { flex: 0.4 } : { flex: 0.6 }]}
                  onPress={handleSubmit}
                  disabled={!isValid}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="send" size={16} color={isValid ? Theme.colors.text.primary : 'rgba(255,255,255,0.4)'} />
                  <Text style={[styles.submitText, !isValid && styles.submitTextDisabled]}>Submit</Text>
                </TouchableOpacity>
              ) : activeTab === questionItems.length - 1 ? (
                <TouchableOpacity
                  style={[styles.submitButton, !isValid && styles.submitButtonDisabled, questionItems.length > 1 && activeTab > 0 ? { flex: 0.4 } : { flex: 0.6 }]}
                  onPress={() => isValid && setActiveTab(questionItems.length)}
                  disabled={!isValid}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="rate-review" size={16} color={isValid ? Theme.colors.text.primary : 'rgba(255,255,255,0.4)'} />
                  <Text style={[styles.submitText, !isValid && styles.submitTextDisabled]}>Review</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.submitButton, !isCurrentQuestionValid && styles.submitButtonDisabled, questionItems.length > 1 && activeTab > 0 ? { flex: 0.4 } : { flex: 0.6 }]}
                  onPress={() => isCurrentQuestionValid && setActiveTab((prev) => prev + 1)}
                  disabled={!isCurrentQuestionValid}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="arrow-forward" size={16} color={isCurrentQuestionValid ? Theme.colors.text.primary : 'rgba(255,255,255,0.4)'} />
                  <Text style={[styles.submitText, !isCurrentQuestionValid && styles.submitTextDisabled]}>Next</Text>
                </TouchableOpacity>
              )
            ) : (
              <TouchableOpacity
                style={[styles.submitButton, !isValid && styles.submitButtonDisabled]}
                onPress={handleSubmit}
                disabled={!isValid}
                activeOpacity={0.7}
              >
                <MaterialIcons name="send" size={16} color={isValid ? Theme.colors.text.primary : 'rgba(255,255,255,0.4)'} />
                <Text style={[styles.submitText, !isValid && styles.submitTextDisabled]}>Submit</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Theme.colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    borderTopWidth: 1,
    borderColor: Theme.colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
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
  collapseButton: {
    padding: 4,
    marginRight: -4,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Theme.colors.text.primary,
  },
  toolBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.25)',
  },
  toolBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Theme.colors.primary.glow,
    textTransform: 'uppercase',
  },
  content: {
    paddingHorizontal: 20,
  },
  contentInner: {
    paddingVertical: 16,
    gap: 20,
  },
  questionSection: {
    gap: 10,
  },
  questionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  questionText: {
    fontSize: 15,
    fontWeight: '600',
    color: Theme.colors.text.primary,
    lineHeight: 22,
  },
  optionsContainer: {
    gap: 6,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  optionRowSelected: {
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
  optionTextContainer: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.colors.text.primary,
  },
  optionLabelSelected: {
    color: Theme.colors.primary.glow,
  },
  optionDescription: {
    fontSize: 12,
    color: Theme.colors.text.muted,
    lineHeight: 17,
  },
  customInputContainer: {
    marginTop: 4,
  },
  customInput: {
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    color: Theme.colors.text.primary,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: Theme.colors.border,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
  },
  skipButton: {
    flex: 0.4,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  skipText: {
    fontSize: 14,
    fontWeight: '700',
    color: Theme.colors.text.secondary,
  },
  submitButton: {
    flex: 0.6,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    backgroundColor: Theme.colors.primary.default,
  },
  submitButtonDisabled: {
    backgroundColor: 'rgba(99, 102, 241, 0.3)',
  },
  submitText: {
    fontSize: 14,
    fontWeight: '700',
    color: Theme.colors.text.primary,
  },
  submitTextDisabled: {
    color: 'rgba(255, 255, 255, 0.4)',
  },
  backButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  backText: {
    fontSize: 14,
    fontWeight: '700',
    color: Theme.colors.text.secondary,
  },
  tabBarContainer: {
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
  },
  tabBar: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  tabButtonActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
  tabButtonDisabled: {
    opacity: 0.4,
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.text.muted,
  },
  tabTextActive: {
    color: Theme.colors.primary.glow,
    fontWeight: '700',
  },
  tabTextDisabled: {
    color: 'rgba(255, 255, 255, 0.2)',
  },
  reviewContainer: {
    gap: 16,
  },
  reviewTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.text.primary,
  },
  reviewSubtitle: {
    fontSize: 13,
    color: Theme.colors.text.muted,
    marginTop: -8,
    marginBottom: 8,
  },
  reviewItem: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    gap: 6,
  },
  reviewItemHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reviewItemQuestionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.colors.text.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reviewEditButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
  },
  reviewEditText: {
    fontSize: 11,
    fontWeight: '600',
    color: Theme.colors.primary.glow,
  },
  reviewItemQuestionText: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.colors.text.primary,
    lineHeight: 20,
  },
  reviewAnswersList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  reviewAnswerBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  reviewAnswerBadgeCustom: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.2)',
  },
  reviewAnswerText: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.secondary.default,
  },
  reviewAnswerTextCustom: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.primary.glow,
  },
});
