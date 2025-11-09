function showNotification(message, type = 'success') {
    const notificationArea = document.getElementById('notification-area');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notificationArea.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
    fetchDecks();
    fetchSettings();
    openTab('decks');

    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');

    if (mobileMenuButton) {
        mobileMenuButton.addEventListener('click', () => {
            sidebar.classList.toggle('sidebar-open');
        });
    }

    // Close sidebar when clicking outside on mobile
    mainContent.addEventListener('click', (event) => {
        if (sidebar.classList.contains('sidebar-open') && window.innerWidth <= 768) {
            // Check if the click is outside the sidebar
            if (!sidebar.contains(event.target) && event.target !== mobileMenuButton) {
                sidebar.classList.remove('sidebar-open');
            }
        }
    });
});

document.getElementById('show-answer-button').addEventListener('click', () => {
    document.getElementById('answer-block').style.display = 'block';
    document.getElementById('show-answer-button').style.display = 'none';
    document.getElementById('rating-buttons').style.display = 'block';
});

function speakText(text, lang = 'en-US') {
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang; // Use the provided language or default
        window.speechSynthesis.speak(utterance);
    } else {
        showNotification('Speech synthesis not supported in this browser.', 'error');
    }
}

// Event listeners for speak buttons
document.querySelectorAll('.speak-button').forEach(button => {
    button.addEventListener('click', (event) => {
        const targetId = event.target.dataset.targetId;
        const textToSpeak = document.getElementById(targetId).textContent;
        let langToUse;
        if (targetId === 'learning-question') {
            langToUse = questionLanguage;
        } else if (targetId === 'learning-answer') {
            langToUse = answerLanguage;
        } else {
            langToUse = 'en-US'; // Fallback
        }
        speakText(textToSpeak, langToUse);
    });
});

let decks = [];
let currentDeckId = null;
let activeLearningQueue = []; // This will hold cards for the current session
let currentCard = null; // The card currently being displayed
let deckChart = null;
let questionLanguage = 'en-US'; // Default
let answerLanguage = 'en-US'; // Default

// New variables for learning progress bar
let totalCardsInQueue = 0; // Initial total cards due for learning
let againCount = 0;
let goodCount = 0;
let easyCount = 0;
let remainingCount = 0; // Cards remaining to be marked good/easy

function updateLearningProgressBar() {
    document.getElementById('remaining-cards-count').textContent = `Remaining: ${remainingCount}`;
    document.getElementById('again-cards-count').textContent = `Again: ${againCount}`;
    document.getElementById('good-cards-count').textContent = `Good: ${goodCount}`;
    document.getElementById('easy-cards-count').textContent = `Easy: ${easyCount}`;
}

function fetchDecks() {
    fetch('/api/decks')
        .then(response => response.json())
        .then(data => {
            decks = data;
            const deckList = document.getElementById('deck-list');
            const deckSelect = document.getElementById('deck-select');
            const importDeckSelect = document.getElementById('import-deck-select');
            const quizDeckSelect = document.getElementById('quiz-deck-select');
            const aiDeckSelect = document.getElementById('ai-deck-select');
            const learningDeckSelect = document.getElementById('learning-deck-select');

            deckList.innerHTML = '';
            deckSelect.innerHTML = '';
            importDeckSelect.innerHTML = '';
            quizDeckSelect.innerHTML = '';
            aiDeckSelect.innerHTML = '';
            learningDeckSelect.innerHTML = '';

            if (decks.length === 0) {
                // Add a default option if no decks exist
                const defaultOption = document.createElement('option');
                defaultOption.value = '';
                defaultOption.textContent = 'No decks available';
                deckSelect.appendChild(defaultOption.cloneNode(true));
                importDeckSelect.appendChild(defaultOption.cloneNode(true));
                quizDeckSelect.appendChild(defaultOption.cloneNode(true));
                aiDeckSelect.appendChild(defaultOption.cloneNode(true));
                learningDeckSelect.appendChild(defaultOption.cloneNode(true));
            }

            decks.forEach(deck => {
                const li = document.createElement('li');
                li.textContent = deck.name;
                li.dataset.deckId = deck.id;
                li.addEventListener('click', () => {
                    currentDeckId = deck.id;
                    fetchCards(currentDeckId);
                    openTab('manage-cards');
                });
                deckList.appendChild(li);

                const option = document.createElement('option');
                option.value = deck.id;
                option.textContent = deck.name;
                deckSelect.appendChild(option.cloneNode(true));
                importDeckSelect.appendChild(option.cloneNode(true));
                quizDeckSelect.appendChild(option.cloneNode(true));
                aiDeckSelect.appendChild(option.cloneNode(true));
                learningDeckSelect.appendChild(option.cloneNode(true));
            });

            if (decks.length > 0) {
                // Set initial selected deck for learning tab and show stats
                learningDeckSelect.value = decks[0].id;
                showDeckStats(decks[0].id);
            }
        });
}

function fetchCards(deckId) {
    const url = deckId ? `/api/decks/${deckId}/cards` : '/api/cards';
    fetch(url)
        .then(response => response.json())
        .then(cards => {
            const cardList = document.getElementById('card-list');
            cardList.innerHTML = '';
            if (cards.length === 0) {
                cardList.innerHTML = '<p>No cards in this deck. Add some above!</p>';
                return;
            }
            cards.forEach(card => {
                const li = document.createElement('li');
                li.dataset.cardId = card.id;
                li.innerHTML = `
                    <div class="card-content">
                        <strong>Q:</strong> ${card.question}<br>
                        <strong>A:</strong> ${card.answer}
                    </div>
                    <div class="card-actions">
                        <button class="edit-btn btn btn-warning">Edit</button>
                        <button class="delete-btn btn btn-danger">Delete</button>
                    </div>
                `;
                cardList.appendChild(li);

                li.querySelector('.edit-btn').addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent li click event
                    editCard(card.id, deckId);
                });
                li.querySelector('.delete-btn').addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent li click event
                    deleteCard(card.id, deckId);
                });
            });
        });
}

function editCard(cardId, deckId) {
    const modal = document.getElementById('edit-card-modal');
    modal.style.display = 'flex'; // Use flex to center modal

    fetch(`/api/cards/${cardId}`)
        .then(response => response.json())
        .then(card => {
            document.getElementById('edit-card-id').value = cardId;
            document.getElementById('edit-question').value = card.question;
            document.getElementById('edit-answer').value = card.answer;
        });

    const form = document.getElementById('edit-card-form');
    form.onsubmit = event => {
        event.preventDefault();
        const newQuestion = document.getElementById('edit-question').value;
        const newAnswer = document.getElementById('edit-answer').value;

        fetch(`/api/cards/${cardId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ question: newQuestion, answer: newAnswer }),
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to update card');
            }
            return response.json();
        })
        .then(() => {
            fetchCards(deckId);
            modal.style.display = 'none';
            showNotification('Card updated successfully.');
        })
        .catch(error => {
            showNotification(`Error updating card: ${error.message}`, 'error');
        });
    };

    const cancelBtn = document.getElementById('cancel-edit-btn');
    cancelBtn.onclick = () => {
        modal.style.display = 'none';
    };
}

function deleteCard(cardId, deckId) {
    const modal = document.getElementById('delete-confirm-modal');
    modal.style.display = 'flex'; // Use flex to center modal

    const confirmBtn = document.getElementById('confirm-delete-btn');
    const cancelBtn = document.getElementById('cancel-delete-btn');

    // Clone to remove previous event listeners
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    newConfirmBtn.onclick = () => {
        fetch(`/api/cards/${cardId}`, {
            method: 'DELETE',
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to delete card');
            }
            return response.json();
        })
        .then(() => {
            fetchCards(deckId);
            modal.style.display = 'none';
            showNotification('Card deleted successfully.');
        })
        .catch(error => {
            showNotification(`Error deleting card: ${error.message}`, 'error');
        });
    };

    newCancelBtn.onclick = () => {
        modal.style.display = 'none';
    };
}

document.getElementById('add-deck-form').addEventListener('submit', event => {
    event.preventDefault();
    const deckName = document.getElementById('deck-name').value.trim();

    if (!deckName) {
        showNotification('Deck name cannot be empty.', 'error');
        return;
    }

    fetch('/api/decks', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: deckName }),
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Failed to add deck');
        }
        return response.json();
    })
    .then(() => {
        fetchDecks();
        document.getElementById('deck-name').value = '';
        showNotification('Deck created successfully!');
    })
    .catch(error => {
        showNotification(`Error creating deck: ${error.message}`, 'error');
    });
});

document.getElementById('add-card-form').addEventListener('submit', event => {
    event.preventDefault();
    const question = document.getElementById('question').value.trim();
    const answer = document.getElementById('answer').value.trim();
    const deckId = document.getElementById('deck-select').value;

    if (!question || !answer) {
        showNotification('Question and Answer cannot be empty.', 'error');
        return;
    }
    if (!deckId) {
        showNotification('Please select a deck.', 'error');
        return;
    }

    fetch('/api/cards', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question, answer, deck_id: deckId }),
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Failed to add card');
        }
        return response.json();
    })
    .then(() => {
        fetchCards(deckId);
        document.getElementById('question').value = '';
        document.getElementById('answer').value = '';
        showNotification('Card added successfully!');
        // Update stats if currently viewing the deck's stats
        if (document.getElementById('learning-deck-select').value === deckId) {
            showDeckStats(deckId);
        }
    })
    .catch(error => {
        showNotification(`Error adding card: ${error.message}`, 'error');
    });
});

document.getElementById('import-button').addEventListener('click', () => {
    const fileInput = document.getElementById('import-file');
    const file = fileInput.files[0];
    const deckId = document.getElementById('import-deck-select').value;

    if (!file) {
        showNotification('Please select a file to import.', 'error');
        return;
    }
    if (!deckId) {
        showNotification('Please select a deck.', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('deck_id', deckId);

    fetch('/api/import', {
        method: 'POST',
        body: formData,
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Failed to import cards');
        }
        return response.json();
    })
    .then(data => {
        showNotification(data.message, 'success');
        fetchCards(deckId);
        // Update stats if currently viewing the deck's stats
        if (document.getElementById('learning-deck-select').value === deckId) {
            showDeckStats(deckId);
        }
    })
    .catch(error => {
        showNotification(`Error importing cards: ${error.message}`, 'error');
    });
});

function openTab(tabName) {
    var i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    tablinks = document.getElementsByClassName("tab-button");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    document.getElementById(tabName).style.display = "block";
    const activeTabButton = document.querySelector(`.tab-button[onclick="openTab('${tabName}')"]`);
    if (activeTabButton) {
        activeTabButton.className += " active";
    }

    // Specific actions when opening tabs
    if (tabName === 'manage-cards' && currentDeckId) {
        fetchCards(currentDeckId);
    } else if (tabName === 'learning') {
        const selectedDeckId = document.getElementById('learning-deck-select').value;
        if (selectedDeckId) {
            showDeckStats(selectedDeckId);
        }
    }
}

let quizQuestions = [];
let currentQuestionIndex = 0;
let score = 0;

document.getElementById('start-quiz-button').addEventListener('click', () => {
    const deckId = document.getElementById('quiz-deck-select').value;
    const quizType = document.querySelector('input[name="quiz-type"]:checked').value;

    if (!deckId) {
        showNotification('Please select a deck to start the quiz.', 'error');
        return;
    }

    const logContainer = document.getElementById('ai-log-container');
    const logElement = document.getElementById('ai-log');
    logContainer.style.display = 'block';
    logElement.textContent = 'Starting quiz...';
    showNotification('Fetching quiz questions...', 'info');

    fetch(`/api/quiz?deck_id=${deckId}&quiz_type=${quizType}`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to fetch quiz questions');
            }
            return response.json();
        })
        .then(questions => {
            if (questions.length === 0) {
                showNotification("No cards available in this deck to start a quiz. Please add some cards first.", 'error');
                logElement.textContent += '\nNo cards found.';
                return;
            }
            quizQuestions = questions;
            currentQuestionIndex = 0;
            score = 0;
            document.getElementById('quiz-setup').style.display = 'none';
            document.getElementById('quiz-container').style.display = 'block';
            document.getElementById('progress-bar').style.width = '0%';
            logElement.textContent += `\nQuiz started with ${questions.length} questions.`;
            showNotification(`Quiz started with ${questions.length} questions!`, 'success');
            displayQuestion();
        })
        .catch(error => {
            showNotification(`Error starting quiz: ${error.message}`, 'error');
            logElement.textContent += `\nError: ${error.message}`;
        });
});

function displayQuestion() {
    const question = quizQuestions[currentQuestionIndex];
    const progressBar = document.getElementById('progress-bar');
    const progress = ((currentQuestionIndex) / quizQuestions.length) * 100; // Progress before current question
    progressBar.style.width = `${progress}%`;

    document.getElementById('question-display').textContent = question.question;
    const answerOptions = document.getElementById('answer-options');
    const answerInput = document.getElementById('answer-input');
    answerOptions.innerHTML = '';
    answerInput.value = ''; // Clear previous answer

    if (question.options) {
        answerInput.style.display = 'none';
        answerOptions.style.display = 'flex'; // Use flex for options
        question.options.forEach(option => {
            const label = document.createElement('label');
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'answer';
            radio.value = option;
            label.appendChild(radio);
            label.appendChild(document.createTextNode(option));
            answerOptions.appendChild(label);
        });
    } else {
        answerInput.style.display = 'block';
        answerOptions.style.display = 'none';
    }

    document.getElementById('feedback').textContent = '';
    document.getElementById('submit-answer-button').style.display = 'block';
    document.getElementById('next-question-button').style.display = 'none';
}

document.getElementById('submit-answer-button').addEventListener('click', () => {
    const question = quizQuestions[currentQuestionIndex];
    const feedback = document.getElementById('feedback');
    let userAnswer;

    if (question.options) {
        const selectedOption = document.querySelector('input[name="answer"]:checked');
        if (selectedOption) {
            userAnswer = selectedOption.value;
        } else {
            showNotification('Please select an option.', 'error');
            return;
        }
    } else {
        userAnswer = document.getElementById('answer-input').value.trim();
        if (!userAnswer) {
            showNotification('Please enter an answer.', 'error');
            return;
        }
    }

    if (userAnswer.toLowerCase() === question.answer.toLowerCase()) {
        feedback.textContent = 'Correct!';
        feedback.style.color = 'green';
        score++;
        showNotification('Correct answer!', 'success');
    } else {
        feedback.textContent = `Wrong! The correct answer is: ${question.answer}`;
        feedback.style.color = 'red';
        showNotification('Incorrect answer.', 'error');
    }

    // Update progress bar to show completion of current question
    const progressBar = document.getElementById('progress-bar');
    const progress = ((currentQuestionIndex + 1) / quizQuestions.length) * 100;
    progressBar.style.width = `${progress}%`;

    document.getElementById('submit-answer-button').style.display = 'none';
    document.getElementById('next-question-button').style.display = 'block';
});

document.getElementById('next-question-button').addEventListener('click', () => {
    currentQuestionIndex++;
    if (currentQuestionIndex < quizQuestions.length) {
        displayQuestion();
    } else {
        endQuiz();
    }
});

document.getElementById('generate-quiz-from-flashcards-button').addEventListener('click', () => {
    const deckId = document.getElementById('quiz-deck-select').value;
    const quizType = document.querySelector('input[name="quiz-type"]:checked').value;

    if (!deckId) {
        showNotification('Please select a deck to generate a quiz.', 'error');
        return;
    }

    const logContainer = document.getElementById('ai-log-container');
    const logElement = document.getElementById('ai-log');
    logContainer.style.display = 'block';
    logElement.textContent = 'Generating quiz from AI...';
    showNotification('Generating quiz from AI...', 'info');

    fetch(`/api/generate-quiz-from-flashcards?deck_id=${deckId}&quiz_type=${quizType}`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to generate quiz from flashcards');
            }
            return response.json();
        })
        .then(data => {
            logElement.textContent = data.log;
            if (data.error) {
                showNotification(data.error, 'error');
                return;
            }
            
            quizQuestions = data.quiz;
            currentQuestionIndex = 0;
            score = 0;
            document.getElementById('quiz-setup').style.display = 'none';
            document.getElementById('quiz-container').style.display = 'block';
            document.getElementById('progress-bar').style.width = '0%';
            showNotification('Quiz generated successfully!', 'success');
            displayQuestion();
        })
        .catch(error => {
            showNotification(`Error generating quiz: ${error.message}`, 'error');
            logElement.textContent += `\nError: ${error.message}`;
        });
});

function endQuiz() {
    showNotification(`Quiz finished! Your score: ${score}/${quizQuestions.length}`, 'info');
    document.getElementById('quiz-container').style.display = 'none';
    document.getElementById('quiz-setup').style.display = 'block';
    document.getElementById('ai-log-container').style.display = 'none';
}

document.getElementById('start-learning-button').addEventListener('click', () => {
    const deckId = document.getElementById('learning-deck-select').value;
    if (!deckId) {
        showNotification('Please select a deck to start learning.', 'error');
        return;
    }
    document.getElementById('deck-stats-container').style.display = 'none';
    showNotification('Fetching cards for learning session...', 'info');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    fetch(`/api/learn/data?deck_id=${deckId}`, { signal: controller.signal })
        .then(response => {
            clearTimeout(timeoutId); // Clear the timeout if the fetch completes
            if (!response.ok) {
                console.error(`HTTP error! status: ${response.status}`);
                throw new Error('Failed to fetch learning data');
            }
            return response.json();
        })
        .then(data => {
            console.log("Learning data fetched:", data);
            if (data.learn_queue.length === 0) {
                showNotification("No cards due for learning in this deck.", 'info');
                document.getElementById('deck-stats-container').style.display = 'block';
                document.getElementById('learning-container').style.display = 'none'; // Hide learning container if no cards
                document.getElementById('start-learning-button').style.display = 'block'; // Show start button again
                document.getElementById('learning-deck-select').style.display = 'block'; // Show deck select again
                return;
            }
            activeLearningQueue = data.learn_queue; // Initialize active queue
            
            totalCardsInQueue = activeLearningQueue.length; // Initial total cards in this session
            againCount = 0;
            goodCount = 0;
            easyCount = 0;
            remainingCount = activeLearningQueue.length; // Remaining is initially all cards in queue

            document.getElementById('learning-container').style.display = 'block';
            document.getElementById('start-learning-button').style.display = 'none';
            document.getElementById('learning-deck-select').style.display = 'none';
            updateLearningProgressBar();
            console.log("Calling displayNextLearningCard...");
            displayNextLearningCard(); // Start displaying cards
            showNotification('Learning session started!', 'success');
        })
        .catch(error => {
            console.error("Error in start-learning-button:", error);
            showNotification(`Error starting learning session: ${error.message}`, 'error');
            document.getElementById('deck-stats-container').style.display = 'block';
            document.getElementById('learning-container').style.display = 'none'; // Hide learning container on error
            document.getElementById('start-learning-button').style.display = 'block'; // Show start button again
            document.getElementById('learning-deck-select').style.display = 'block'; // Show deck select again
        });
});

function displayNextLearningCard() {
    if (activeLearningQueue.length === 0) {
        endLearningSession();
        return;
    }

    // Get a random card from the active queue
    const randomIndex = Math.floor(Math.random() * activeLearningQueue.length);
    currentCard = activeLearningQueue.splice(randomIndex, 1)[0]; // Remove and get the card

    if (!currentCard) { // Added check
        endLearningSession();
        return;
    }

    document.getElementById('learning-question').textContent = currentCard.question;
    document.getElementById('learning-answer').textContent = currentCard.answer;
    document.getElementById('answer-block').style.display = 'none'; // Ensure answer is hidden
    document.getElementById('show-answer-button').style.display = 'block'; // Ensure show answer button is visible
    document.getElementById('rating-buttons').style.display = 'none';

    console.log("Current Card:", currentCard);
}

function rateCard(rating) {
    fetch(`/api/learn/cards/${currentCard.id}/answer`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rating }),
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Failed to rate card');
        }
        return response.json();
    })
    .then(() => {
        if (rating === 'again') {
            againCount++;
            // Re-add the card to the active queue for re-presentation
            // Add it to a random position to avoid immediate repetition
            const insertIndex = Math.floor(Math.random() * (activeLearningQueue.length + 1));
            activeLearningQueue.splice(insertIndex, 0, currentCard);
            // remainingCount does not change as the card is re-added to the queue
            showNotification('Card marked "Again". Will reappear later.', 'info');
        } else { // 'good' or 'easy'
            if (rating === 'good') {
                goodCount++;
            } else if (rating === 'easy') {
                easyCount++;
            }
            remainingCount--; // Decrement only if card is "finished" for this session
            showNotification(`Card marked "${rating.charAt(0).toUpperCase() + rating.slice(1)}"!`, 'success');
        }
        updateLearningProgressBar();
        
        // Move to the next card
        displayNextLearningCard();
    })
    .catch(error => {
        showNotification(`Error rating card: ${error.message}`, 'error');
    });
}

function endLearningSession() {
    showNotification('Learning session finished!', 'info');
    document.getElementById('learning-container').style.display = 'none';
    document.getElementById('start-learning-button').style.display = 'block';
    document.getElementById('learning-deck-select').style.display = 'block';
    document.getElementById('deck-stats-container').style.display = 'block';
    
    // Reset progress bar counts and active queue
    activeLearningQueue = [];
    currentCard = null;
    totalCardsInQueue = 0;
    againCount = 0;
    goodCount = 0;
    easyCount = 0;
    remainingCount = 0;
    updateLearningProgressBar();

    // Refresh stats after learning session ends
    const currentDeckId = document.getElementById('learning-deck-select').value;
    if (currentDeckId) {
        showDeckStats(currentDeckId);
    }
}

function showDeckStats(deckId) {
    fetch(`/api/deck/${deckId}/stats`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to fetch deck stats');
            }
            return response.json();
        })
        .then(stats => {
            const statsContainer = document.getElementById('deck-stats');
            statsContainer.innerHTML = `
                <p><strong>Total Cards:</strong> ${stats.total_cards}</p>
                <p><strong>New Cards:</strong> ${stats.to_learn_count}</p>
                <p><strong>Learning Cards:</strong> ${stats.learning_count}</p>
                <p><strong>Mature Cards:</strong> ${stats.mastered_count}</p>
            `;

            const chartCanvas = document.getElementById('deck-chart');
            const chartData = {
                labels: ['New', 'Learning', 'Mature'],
                datasets: [{
                    data: [stats.to_learn_count, stats.learning_count, stats.mastered_count],
                    backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56'],
                    hoverOffset: 4
                }]
            };

            if (deckChart) {
                deckChart.destroy();
            }

            deckChart = new Chart(chartCanvas, {
                type: 'pie',
                data: chartData,
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            position: 'top',
                        },
                        title: {
                            display: true,
                            text: 'Deck Progress Overview'
                        }
                    }
                }
            });

            document.getElementById('deck-stats-container').style.display = 'block';
        })
        .catch(error => {
            showNotification(`Error fetching deck stats: ${error.message}`, 'error');
            document.getElementById('deck-stats-container').style.display = 'none'; // Hide if error
        });
}

document.getElementById('learning-deck-select').addEventListener('change', (event) => {
    const deckId = event.target.value;
    if (deckId) {
        showDeckStats(deckId);
    } else {
        document.getElementById('deck-stats-container').style.display = 'none';
    }
});

document.getElementById('generate-cards-form').addEventListener('submit', event => {
    event.preventDefault();
    const topic = document.getElementById('topic-input').value.trim();
    const deckId = document.getElementById('ai-deck-select').value;

    if (!topic) {
        showNotification('Please enter a topic.', 'error');
        return;
    }
    if (!deckId) {
        showNotification('Please select a deck.', 'error');
        return;
    }

    const logContainer = document.getElementById('ai-log-container');
    const logElement = document.getElementById('ai-log');
    logContainer.style.display = 'block';
    logElement.textContent = 'Generating cards from AI...';
    showNotification('Generating cards from AI...', 'info');

    fetch('/api/generate-cards', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ topic, deck_id: deckId }),
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Failed to generate cards');
        }
        return response.json();
    })
    .then(data => {
        logElement.textContent = data.log;
        if (data.error) {
            showNotification(data.error, 'error');
            return;
        }
        
        fetchCards(deckId);
        document.getElementById('topic-input').value = '';
        showNotification(`${data.cards.length} new cards about "${topic}" have been added to your deck!`, 'success');
        // Update stats if currently viewing the deck's stats
        if (document.getElementById('learning-deck-select').value === deckId) {
            showDeckStats(deckId);
        }
    })
    .catch(error => {
        showNotification(`Error generating cards: ${error.message}`, 'error');
        logElement.textContent += `\nError: ${error.message}`;
    });
});

document.getElementById('create-quiz-form').addEventListener('submit', event => {
    event.preventDefault();
    const fileInput = document.getElementById('pdf-file-input');
    const file = fileInput.files[0];
    if (!file) {
        showNotification('Please select a PDF file.', 'error');
        return;
    }

    const quizType = document.querySelector('input[name="quiz-type"]:checked').value;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('quiz_type', quizType);

    const logContainer = document.getElementById('ai-log-container');
    const logElement = document.getElementById('ai-log');
    logContainer.style.display = 'block';
    logElement.textContent = 'Creating quiz from PDF...';
    showNotification('Creating quiz from PDF...', 'info');

    fetch('/api/create-quiz-from-pdf', {
        method: 'POST',
        body: formData,
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Failed to create quiz from PDF');
        }
        return response.json();
    })
    .then(data => {
        logElement.textContent = data.log;
        if (data.error) {
            showNotification(data.error, 'error');
            return;
        }

        quizQuestions = data.quiz;
        currentQuestionIndex = 0;
        score = 0;
        openTab('quiz-mode');
        document.getElementById('quiz-setup').style.display = 'none';
        document.getElementById('quiz-container').style.display = 'block';
        document.getElementById('progress-bar').style.width = '0%';
        displayQuestion();
        showNotification('Quiz created from PDF successfully!', 'success');
    })
    .catch(error => {
        showNotification(`Error creating quiz from PDF: ${error.message}`, 'error');
        logElement.textContent += `\nError: ${error.message}`;
    });
});

function fetchSettings() {
    fetch('/api/settings')
        .then(response => response.json())
        .then(settings => {
            document.getElementById('quiz_questions').value = settings.quiz_questions;
            document.getElementById('new_cards_per_day').value = settings.new_cards_per_day;
            document.getElementById('gemini_api_key').value = settings.gemini_api_key;
            document.getElementById('gemini_model').value = settings.gemini_model;
            document.getElementById('question_language').value = settings.question_language;
            document.getElementById('answer_language').value = settings.answer_language;
            document.getElementById('disable_google_login').checked = settings.disable_google_login;
            questionLanguage = settings.question_language;
            answerLanguage = settings.answer_language;
        });
}

document.getElementById('settings-form').addEventListener('submit', event => {
    event.preventDefault();
    const quiz_questions = document.getElementById('quiz_questions').value;
    const new_cards_per_day = document.getElementById('new_cards_per_day').value;
    const gemini_api_key = document.getElementById('gemini_api_key').value;
    const gemini_model = document.getElementById('gemini_model').value;
    const question_language = document.getElementById('question_language').value;
    const answer_language = document.getElementById('answer_language').value;
    const disable_google_login = document.getElementById('disable_google_login').checked;

    fetch('/api/settings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            quiz_questions: parseInt(quiz_questions),
            new_cards_per_day: parseInt(new_cards_per_day),
            gemini_api_key: gemini_api_key,
            gemini_model: gemini_model,
            question_language: question_language,
            answer_language: answer_language,
            disable_google_login: disable_google_login
        }),
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Failed to save settings');
        }
        return response.json();
    })
    .then(() => {
        showNotification('Settings saved!', 'success');
        questionLanguage = question_language;
        answerLanguage = answer_language;
    })
    .catch(error => {
        showNotification(`Error saving settings: ${error.message}`, 'error');
    });
});