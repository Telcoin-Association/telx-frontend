import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";
import { RootState, AppDispatch } from "@/redux/store";

// export hook variables with typescript types defined
// allows us to import these hooks from the hooks file instead of the base functions from redux
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector; // alias the useSelector function by adding types
