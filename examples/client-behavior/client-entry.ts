import { bootClient } from '../../core/client';
import todosController from './pages/todos.client';

bootClient({
  debug: true,
  controllers: {
    todos: todosController,
  },
});
