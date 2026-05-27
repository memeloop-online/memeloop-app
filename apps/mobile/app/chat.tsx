import { useState } from 'react';
import { View, FlatList, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput, IconButton, Card, Text } from 'react-native-paper';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  const sendMessage = () => {
    if (!input.trim()) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');

    // TODO: Connect to memeloop-node via WebSocket
    // const assistantMsg: Message = {
    //   id: `assistant-${Date.now()}`,
    //   role: 'assistant',
    //   content: 'Response from agent...',
    //   timestamp: Date.now(),
    // };
    // setTimeout(() => setMessages(prev => [...prev, assistantMsg]), 1000);
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <Card style={[
      styles.messageCard,
      item.role === 'user' ? styles.userMessage : styles.assistantMessage,
    ]}>
      <Card.Content>
        <Text style={styles.messageContent}>{item.content}</Text>
      </Card.Content>
    </Card>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <FlatList
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          mode="outlined"
          placeholder="Type a message..."
          value={input}
          onChangeText={setInput}
          onSubmitEditing={sendMessage}
        />
        <IconButton
          icon="send"
          mode="contained"
          onPress={sendMessage}
          disabled={!input.trim()}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: 16,
  },
  messageCard: {
    marginBottom: 8,
    maxWidth: '85%',
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#e3f2fd',
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
  },
  messageContent: {
    fontSize: 14,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  input: {
    flex: 1,
    marginRight: 8,
  },
});
