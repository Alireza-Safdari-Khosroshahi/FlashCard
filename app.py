import os
from flask import Flask, render_template, request, jsonify, redirect, url_for, session
import json
import random
from datetime import datetime, timedelta
import google.generativeai as genai
from PyPDF2 import PdfReader
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from requests_oauthlib import OAuth2Session

os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

if os.environ.get('FLASK_ENV') == 'development': # Use FLASK_ENV to determine debug mode
    pass # This block is now redundant for OAUTHLIB_INSECURE_TRANSPORT

app = Flask(__name__)
app.config['PREFERRED_URL_SCHEME'] = 'https'
# app.config['SERVER_NAME'] = 'ars-berlin.de'

# Configuration for Flask-Login
app.config['SECRET_KEY'] = 'your_super_secret_key' # TODO: Replace with a strong, random secret key
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

CARDS_FILE = 'cards.json'
DECKS_FILE = 'decks.json'
CONFIG_FILE = 'config.json'

# User management (in-memory for simplicity, replace with a database in production)
users = {} # user_id: User object

class User(UserMixin):
    def __init__(self, id, name):
        self.id = id
        self.name = name

    def get_id(self):
        return str(self.id)

@login_manager.user_loader
def load_user(user_id):
    return users.get(user_id)

from functools import wraps

def login_required_conditional(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        config = get_config()
        if config.get('disable_google_login', False):
            # If login is disabled, allow access without authentication
            return f(*args, **kwargs)
        else:
            # Otherwise, enforce login_required
            return login_required(f)(*args, **kwargs)
    return decorated_function

def extract_json_from_markdown(text):
    # Find the start of the JSON content
    start_index = text.find('```json')
    if start_index != -1:
        text = text[start_index + 7:]  # Move past ```json
    
    # Find the end of the JSON content
    end_index = text.rfind('```')
    if end_index != -1:
        text = text[:end_index]
        
    return text.strip()

def get_cards(deck_id=None):
    if not os.path.exists(CARDS_FILE):
        return []
    with open(CARDS_FILE, 'r') as f:
        cards = json.load(f)
        if deck_id:
            return [card for card in cards if card.get('deck_id') == deck_id]
        return cards

def save_cards(cards):
    with open(CARDS_FILE, 'w') as f:
        json.dump(cards, f, indent=4)

def get_decks():
    if not os.path.exists(DECKS_FILE):
        return []
    with open(DECKS_FILE, 'r') as f:
        return json.load(f)

def save_decks(decks):
    with open(DECKS_FILE, 'w') as f:
        json.dump(decks, f, indent=4)

def get_config():
    if not os.path.exists(CONFIG_FILE):
        return {'quiz_questions': 10, 'gemini_api_key': '', 'gemini_model': 'gemini-pro', 'new_cards_per_day': 20, 'question_language': 'en-US', 'answer_language': 'en-US', 'GOOGLE_CLIENT_ID': '', 'GOOGLE_CLIENT_SECRET': '', 'GOOGLE_LOGIN_ENABLED': True}
    with open(CONFIG_FILE, 'r') as f:
        config = json.load(f)
        if 'new_cards_per_day' not in config:
            config['new_cards_per_day'] = 20
        if 'question_language' not in config:
            config['question_language'] = 'en-US'
        if 'answer_language' not in config:
            config['answer_language'] = 'en-US'
        if 'GOOGLE_CLIENT_ID' not in config:
            config['GOOGLE_CLIENT_ID'] = ''
        if 'GOOGLE_CLIENT_SECRET' not in config:
            config['GOOGLE_CLIENT_SECRET'] = ''
        if 'GOOGLE_LOGIN_ENABLED' not in config:
            config['GOOGLE_LOGIN_ENABLED'] = True
        if 'disable_google_login' not in config:
            config['disable_google_login'] = False
        return config

def save_config(config):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=4)

# Google OAuth Configuration
config = get_config()
GOOGLE_CLIENT_ID = config.get('GOOGLE_CLIENT_ID')
GOOGLE_CLIENT_SECRET = config.get('GOOGLE_CLIENT_SECRET')
GOOGLE_AUTHORIZATION_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
GOOGLE_SCOPE = ["openid", "email", "profile"]

@app.route('/login')
def login():
    config = get_config()
    if config.get('disable_google_login', False): # Default to False if not set
        return redirect(url_for('index'))
    google = OAuth2Session(GOOGLE_CLIENT_ID, scope=GOOGLE_SCOPE, redirect_uri=url_for('callback', _external=True, _scheme='https'))
    authorization_url, state = google.authorization_url(GOOGLE_AUTHORIZATION_BASE_URL, access_type="offline", prompt="select_account")
    session['oauth_state'] = state
    return redirect(authorization_url)

@app.route('/callback')
def callback():
    if 'oauth_state' not in session or session['oauth_state'] != request.args.get('state'):
        return jsonify({'error': 'Invalid state parameter'}), 400

    google = OAuth2Session(GOOGLE_CLIENT_ID, state=session['oauth_state'], redirect_uri=url_for('callback', _external=True, _scheme='https'))
    token = google.fetch_token(GOOGLE_TOKEN_URL, client_secret=GOOGLE_CLIENT_SECRET, authorization_response=request.url)
    
    userinfo_response = google.get(GOOGLE_USERINFO_URL)
    user_info = userinfo_response.json()

    user_id = user_info['sub']
    user_name = user_info['name']
    
    user = User(user_id, user_name)
    users[user_id] = user # Store user in our in-memory dict
    login_user(user)
    
    return redirect(url_for('index'))

@app.route('/logout')
@login_required_conditional
def logout():
    logout_user()
    return redirect(url_for('index'))

@app.route('/api/decks', methods=['GET'])
@login_required_conditional
def get_all_decks():
    return jsonify(get_decks())

@app.route('/api/decks', methods=['POST'])
@login_required_conditional
def add_deck():
    decks = get_decks()
    new_deck = request.get_json()
    new_deck['id'] = str(random.randint(1000, 9999))
    decks.append(new_deck)
    save_decks(decks)
    return jsonify(new_deck)

@app.route('/api/decks/<deck_id>/cards', methods=['GET'])
@login_required_conditional
def get_deck_cards(deck_id):
    return jsonify(get_cards(deck_id))

@app.route('/api/cards', methods=['POST'])
@login_required_conditional
def add_card():
    cards = get_cards()
    new_card = request.get_json()
    new_card['id'] = str(random.randint(1000, 9999))
    new_card['due_date'] = datetime.now().isoformat()
    new_card['interval'] = 0
    cards.append(new_card)
    save_cards(cards)
    return jsonify(new_card)

@app.route('/api/cards/<card_id>', methods=['GET'])
@login_required_conditional
def get_card(card_id):
    cards = get_cards()
    card = next((c for c in cards if c['id'] == card_id), None)
    if not card:
        return jsonify({'error': 'Card not found'}), 404
    return jsonify(card)

@app.route('/api/cards/<card_id>', methods=['PUT'])
@login_required_conditional
def update_card(card_id):
    cards = get_cards()
    card = next((c for c in cards if c['id'] == card_id), None)
    if not card:
        return jsonify({'error': 'Card not found'}), 404

    data = request.get_json()
    card['question'] = data.get('question', card['question'])
    card['answer'] = data.get('answer', card['answer'])
    save_cards(cards)
    return jsonify(card)

@app.route('/api/cards/<card_id>', methods=['DELETE'])
@login_required_conditional
def delete_card(card_id):
    cards = get_cards()
    cards = [c for c in cards if c['id'] != card_id]
    save_cards(cards)
    return jsonify({'message': 'Card deleted'})

@app.route('/api/import', methods=['POST'])
@login_required_conditional
def import_cards():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if file and file.filename.endswith('.json'):
        new_cards = json.load(file)
        deck_id = request.form.get('deck_id')
        for card in new_cards:
            card['id'] = str(random.randint(1000, 9999))
            card['due_date'] = datetime.now().isoformat()
            card['interval'] = 0
            if deck_id:
                card['deck_id'] = deck_id
        cards = get_cards()
        cards.extend(new_cards)
        save_cards(cards)
        return jsonify({'message': f'{len(new_cards)} cards imported successfully'})
    return jsonify({'error': 'Invalid file format'}), 400

@app.route('/api/quiz', methods=['GET'])
@login_required_conditional
def get_quiz():
    deck_id = request.args.get('deck_id')
    quiz_type = request.args.get('quiz_type', 'long-answer')
    cards = get_cards(deck_id)
    random.shuffle(cards)
    config = get_config()
    num_questions = int(request.args.get('num_questions', config.get('quiz_questions', 10)))
    
    questions = []
    for card in cards[:min(num_questions, len(cards))]:
        if quiz_type == 'multiple-choice':
            options = [card['answer']]
            wrong_answers = [c['answer'] for c in cards if c['id'] != card['id']]
            random.shuffle(wrong_answers)
            options.extend(wrong_answers[:3])
            random.shuffle(options)
            questions.append({
                'question': card['question'],
                'options': options,
                'answer': card['answer']
            })
        else:
            questions.append(card)
            
    return jsonify(questions)

@app.route('/api/learn/data', methods=['GET'])
@login_required_conditional
def get_learning_data():
    deck_id = request.args.get('deck_id')
    if not deck_id:
        print("Error: deck_id is missing for /api/learn/data")
        return jsonify({'error': 'Deck ID is required for learning data.'}), 400

    try:
        all_cards_in_deck = get_cards(deck_id)
        config = get_config()
        new_cards_limit = config.get('new_cards_per_day', 20)

        now = datetime.now()
        
        due_cards = []
        for card in all_cards_in_deck:
            # Ensure due_date exists and is a valid ISO format, fallback to now if not
            card_due_date_str = card.get('due_date')
            if card_due_date_str:
                try:
                    card_due_date = datetime.fromisoformat(card_due_date_str)
                except ValueError:
                    print(f"Warning: Malformed due_date for card {card.get('id')}: {card_due_date_str}. Using current time.")
                    card_due_date = now
            else:
                card_due_date = now # If due_date is missing, consider it due now

            if card_due_date <= now:
                due_cards.append(card)

        new_cards = [card for card in due_cards if card.get('interval', 0) == 0]
        review_cards = [card for card in due_cards if card.get('interval', 0) > 0]

        random.shuffle(new_cards)
        limited_new_cards = new_cards[:new_cards_limit]

        learn_queue = limited_new_cards + review_cards
        random.shuffle(learn_queue)
        
        return jsonify({
            'learn_queue': learn_queue,
            'total_cards_in_queue': len(learn_queue),
            'new_cards_in_queue': len(limited_new_cards),
            'review_cards_in_queue': len(review_cards)
        })
    except Exception as e:
        print(f"Error in get_learning_data: {e}")
        return jsonify({'error': f'An internal server error occurred: {str(e)}'}), 500

@app.route('/api/learn/cards/<card_id>/answer', methods=['POST'])
@login_required_conditional
def answer_card(card_id):
    cards = get_cards()
    card = next((c for c in cards if c['id'] == card_id), None)
    if not card:
        return jsonify({'error': 'Card not found'}), 404

    rating = request.json.get('rating')
    if rating == 'again':
        card['interval'] = 0
        card['due_date'] = datetime.now().isoformat() # Make it immediately due
    elif rating == 'good':
        card['interval'] = max(1, card.get('interval', 0) * 2)
        card['due_date'] = (datetime.now() + timedelta(days=card['interval'])).isoformat()
    elif rating == 'easy':
        card['interval'] = max(1, card.get('interval', 0) * 4)
        card['due_date'] = (datetime.now() + timedelta(days=card['interval'])).isoformat()

    save_cards(cards)
    return jsonify(card)

@app.route('/api/settings', methods=['GET'])
@login_required_conditional
def get_settings():
    return jsonify(get_config())

@app.route('/api/settings', methods=['POST'])
@login_required_conditional
def update_settings():
    new_config = request.get_json()
    config = get_config()
    config['quiz_questions'] = new_config.get('quiz_questions', config['quiz_questions'])
    config['new_cards_per_day'] = new_config.get('new_cards_per_day', config['new_cards_per_day'])
    config['gemini_api_key'] = new_config.get('gemini_api_key', config['gemini_api_key'])
    config['gemini_model'] = new_config.get('gemini_model', config['gemini_model'])
    config['question_language'] = new_config.get('question_language', config['question_language'])
    config['answer_language'] = new_config.get('answer_language', config['answer_language'])
    config['GOOGLE_CLIENT_ID'] = new_config.get('GOOGLE_CLIENT_ID', config['GOOGLE_CLIENT_ID'])
    config['GOOGLE_CLIENT_SECRET'] = new_config.get('GOOGLE_CLIENT_SECRET', config['GOOGLE_CLIENT_SECRET'])
    config['GOOGLE_LOGIN_ENABLED'] = new_config.get('GOOGLE_LOGIN_ENABLED', config['GOOGLE_LOGIN_ENABLED'])
    config['disable_google_login'] = new_config.get('disable_google_login', config['disable_google_login'])
    save_config(config)
    return jsonify(config)

@app.route('/api/generate-cards', methods=['POST'])
@login_required_conditional
def generate_cards():
    data = request.get_json()
    topic = data.get('topic')
    deck_id = data.get('deck_id')
    
    log = "Generating cards from AI...\n"
    config = get_config()
    if not config.get('gemini_api_key'):
        log += "Error: Gemini API key is not set.\n"
        return jsonify({'error': 'Gemini API key is not set.', 'log': log}), 400

    genai.configure(api_key=config['gemini_api_key'])
    model = genai.GenerativeModel(config['gemini_model'])
    
    prompt = f"Generate 5 flashcards about {topic} in JSON format with 'question' and 'answer' keys."
    log += f"Prompt: {prompt}\n"
    
    response = model.generate_content(prompt)
    log += f"Gemini Response: {response.text}\n"
    
    try:
        json_text = extract_json_from_markdown(response.text)
        new_cards = json.loads(json_text)
        log += "Successfully generated cards.\n"
    except (json.JSONDecodeError, TypeError):
        log += "Error: Failed to generate cards from Gemini API.\n"
        return jsonify({'error': 'Failed to generate cards from Gemini API.', 'log': log}), 500

    for card in new_cards:
        card['deck_id'] = deck_id
        card['id'] = str(random.randint(1000, 9999))
        card['due_date'] = datetime.now().isoformat()
        card['interval'] = 0
        
    cards = get_cards()
    cards.extend(new_cards)
    save_cards(cards)
    
    log += f"{len(new_cards)} cards added to the deck."
    return jsonify({'cards': new_cards, 'log': log})

@app.route('/api/create-quiz-from-pdf', methods=['POST'])
@login_required_conditional
def create_quiz_from_pdf():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    log = "Creating quiz from PDF...\n"
    try:
        pdf_reader = PdfReader(file)
        text = ""
        for page in pdf_reader.pages:
            text += page.extract_text()
        log += "Successfully extracted text from PDF.\n"
    except Exception as e:
        log += f"Error reading PDF: {e}\n"
        return jsonify({'error': f"Error reading PDF: {e}", 'log': log}), 500

    config = get_config()
    if not config.get('gemini_api_key'):
        log += "Error: Gemini API key is not set.\n"
        return jsonify({'error': 'Gemini API key is not set.', 'log': log}), 400
        
    quiz_type = request.form.get('quiz_type', 'multiple-choice')
    genai.configure(api_key=config['gemini_api_key'])
    model = genai.GenerativeModel(config['gemini_model'])

    if quiz_type == 'multiple-choice':
        prompt = f"Based on the following text, generate a quiz with 5 multiple choice questions in JSON format. Each question should have 'question', 'options' (an array of 4 strings), and 'answer' keys:\n\n{text}"
    else:
        prompt = f"Based on the following text, generate a quiz with 5 long answer questions in JSON format with 'question' and 'answer' keys:\n\n{text}"
    
    log += f"Prompt: {prompt}\n"
    response = model.generate_content(prompt)
    log += f"Gemini Response: {response.text}\n"

    try:
        json_text = extract_json_from_markdown(response.text)
        quiz = json.loads(json_text)
        log += "Successfully generated quiz.\n"
    except (json.JSONDecodeError, TypeError):
        log += "Error: Failed to generate quiz from Gemini API.\n"
        return jsonify({'error': 'Failed to generate quiz from Gemini API.', 'log': log}), 500

    return jsonify({'quiz': quiz, 'log': log})

@app.route('/api/generate-quiz-from-flashcards', methods=['GET'])
@login_required_conditional
def generate_quiz_from_flashcards():
    deck_id = request.args.get('deck_id')
    cards = get_cards(deck_id)
    
    log = "Generating quiz from flashcards...\n"
    config = get_config()
    if not config.get('gemini_api_key'):
        log += "Error: Gemini API key is not set.\n"
        return jsonify({'error': 'Gemini API key is not set.', 'log': log}), 400

    genai.configure(api_key=config['gemini_api_key'])
    model = genai.GenerativeModel(config['gemini_model'])
    
    quiz_type = request.args.get('quiz_type', 'multiple-choice')
    card_str = json.dumps(cards)

    if quiz_type == 'multiple-choice':
        prompt = f"Based on the following flashcards, generate a quiz with 5 multiple choice questions in JSON format. Each question should have 'question', 'options' (an array of 4 strings), and 'answer' keys:\n\n{card_str}"
    else:
        prompt = f"Based on the following flashcards, generate a quiz with 5 long answer questions in JSON format with 'question' and 'answer' keys:\n\n{card_str}"
    
    log += f"Prompt: {prompt}\n"
    response = model.generate_content(prompt)
    log += f"Gemini Response: {response.text}\n"
    
    try:
        json_text = extract_json_from_markdown(response.text)
        quiz = json.loads(json_text)
        log += "Successfully generated quiz.\n"
    except (json.JSONDecodeError, TypeError):
        log += "Error: Failed to generate quiz from Gemini API.\n"
        return jsonify({'error': 'Failed to generate quiz from Gemini API.', 'log': log}), 500

    return jsonify({'quiz': quiz, 'log': log})

@app.route('/api/deck/<deck_id>/stats', methods=['GET'])
@login_required_conditional
def get_deck_stats(deck_id):
    cards = get_cards(deck_id)
    total_cards = len(cards)
    new_cards = 0
    learning_cards = 0
    mature_cards = 0

    for card in cards:
        interval = card.get('interval', 0)
        if interval == 0:
            new_cards += 1
        elif 0 < interval < 21:
            learning_cards += 1
        else:
            mature_cards += 1
            
    return jsonify({
        'total_cards': total_cards,
        'to_learn_count': new_cards,
        'learning_count': learning_cards,
        'mastered_count': mature_cards
    })

@app.route('/')
def index():
    config = get_config()
    disable_login = config.get('disable_google_login', False)
    if not disable_login and not current_user.is_authenticated:
        return redirect(url_for('login'))
    return render_template('index.html', disable_google_login=disable_login)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(debug=True, host='0.0.0.0', port=port)